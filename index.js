require('dotenv').config();

process.on('uncaughtException', err => console.error('Uncaught:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const APP_SECRET     = process.env.WA_APP_SECRET;
const ADMIN_USER     = process.env.ADMIN_USER     || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const sseClients = new Set();

// ── Arrange Express BEFORE loading heavy modules ───────────────────────────────
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ ok: true, initialized }));
app.get('/', (_req, res) => res.redirect('/admin.html'));

// Start listening immediately so Render health check passes
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  init();
});

// ── Lazy-loaded modules ────────────────────────────────────────────────────────
let db, sendText, markRead, getMediaUrl, downloadMedia, processMessage, sendAndSave, transcribeAudio;
let R1_MESSAGE, R2_MESSAGE;
let initialized = false;

async function init() {
  try {
    db = require('./db');
    console.log('db OK');

    const wa = require('./whatsapp');
    sendText      = wa.sendText;
    markRead      = wa.markRead;
    getMediaUrl   = wa.getMediaUrl;
    downloadMedia = wa.downloadMedia;
    console.log('whatsapp OK');

    const flows = require('./flows');
    processMessage = flows.processMessage;
    sendAndSave    = flows.sendAndSave;
    console.log('flows OK');

    const content = require('./content');
    R1_MESSAGE = content.R1_MESSAGE;
    R2_MESSAGE = content.R2_MESSAGE;
    console.log('content OK');

    transcribeAudio = require('./transcribe').transcribeAudio;
    console.log('transcribe OK');

    initialized = true;
    console.log('All modules loaded — bot is ready');

    startScheduler();
  } catch (err) {
    console.error('INIT ERROR:', err);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

function verifySignature(req, res, next) {
  if (!APP_SECRET) return next();
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return res.sendStatus(403);
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.body).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(403);
  next();
}

function adminAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const [type, encoded] = auth.split(' ');
  if (type !== 'Basic' || !encoded) return res.set('WWW-Authenticate', 'Basic realm="Admin"').sendStatus(401);
  const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) return res.set('WWW-Authenticate', 'Basic realm="Admin"').sendStatus(401);
  next();
}

// ── Webhook ────────────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', verifySignature, async (req, res) => {
  res.sendStatus(200);
  if (!initialized) return;

  let body;
  try { body = JSON.parse(req.body.toString()); } catch { return; }

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  if (!value?.messages?.length) return;

  const msg     = value.messages[0];
  const phone   = msg.from;
  const wamid   = msg.id;
  const msgType = msg.type;

  const referral = msg.referral;
  console.log(`[referral] phone=${phone} referral=${JSON.stringify(referral || null)}`);
  if (referral?.ctwa_clid) {
    db.createContact(phone);
    const c = db.getContact(phone);
    if (!c?.ctwa_clid) {
      db.updateContact(phone, {
        ctwa_clid: referral.ctwa_clid,
        ad_id:     referral.source_id || '',
        ad_name:   referral.headline || referral.source_id || referral.source_url || ''
      });
    }
  }

  const profile = value.contacts?.[0]?.profile;
  if (profile?.name) {
    const c = db.getContact(phone);
    if (!c || c.name === '') db.updateContact(phone, { name: profile.name });
  }

  markRead(wamid);

  let content = '';
  try {
    if (msgType === 'text') {
      content = msg.text?.body || '';
      await processMessage(phone, 'text', content, wamid);

    } else if (msgType === 'image') {
      const mediaId = msg.image?.id;
      if (mediaId) {
        const mediaUrl = await getMediaUrl(mediaId);
        const { buffer, mimeType } = await downloadMedia(mediaUrl);
        const payload = JSON.stringify({ buffer: buffer.toString('base64'), mimeType });
        content = payload;
        await processMessage(phone, 'image', payload, wamid);
      }

    } else if (msgType === 'audio') {
      const mediaId = msg.audio?.id;
      if (mediaId) {
        try {
          const mediaUrl = await getMediaUrl(mediaId);
          const { buffer, mimeType } = await downloadMedia(mediaUrl);
          const transcription = await transcribeAudio(buffer, mimeType);
          content = transcription;
          console.log(`Audio transcrito [${phone}]: ${transcription.substring(0, 80)}`);
          await processMessage(phone, 'text', transcription, wamid);
        } catch (e) {
          console.error('Transcripcion error:', e.message);
          await processMessage(phone, 'text', '[audio]', wamid);
        }
      }
    } else if (msgType === 'document') {
      const doc = msg.document;
      const mime = doc?.mime_type || '';
      const mediaId = doc?.id;
      if (mediaId && (mime === 'application/pdf' || mime.startsWith('image/'))) {
        try {
          const mediaUrl = await getMediaUrl(mediaId);
          const { buffer, mimeType: resolvedMime } = await downloadMedia(mediaUrl);
          const payload = JSON.stringify({ buffer: buffer.toString('base64'), mimeType: resolvedMime || mime });
          content = payload;
          await processMessage(phone, 'image', payload, wamid);
        } catch (e) {
          console.error('Document download error:', e.message);
          await processMessage(phone, 'document', '[documento]', wamid);
        }
      } else {
        content = '[documento]';
        await processMessage(phone, 'document', '[documento]', wamid);
      }
    } else if (msgType === 'video') {
      content = '[video]';
      await processMessage(phone, 'video', '[video]', wamid);
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }

  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
});

// ── Admin SSE ──────────────────────────────────────────────────────────────────
// EventSource no soporta headers — auth via query token
app.get('/admin/events', (req, res) => {
  try {
    const [user, pass] = Buffer.from(req.query.token || '', 'base64').toString().split(':');
    if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) return res.sendStatus(401);
  } catch { return res.sendStatus(401); }

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');

  const interval = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); clearInterval(interval); });
});

// ── Admin REST API ─────────────────────────────────────────────────────────────
app.get('/api/contacts', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const { q, tag, filter } = req.query;
  if (q)                    return res.json(db.searchContacts(q));
  if (tag)                  return res.json(db.getContactsByTag(tag));
  if (filter === 'unread')  return res.json(db.getUnreadContacts());
  res.json(db.getAllContacts());
});

app.get('/api/contacts/:phone/messages', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  res.json(db.getMessages(req.params.phone, 100));
});

app.patch('/api/contacts/:phone', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const allowed = ['bot_active', 'tag', 'name', 'state', 'unread_count'];
  const fields = {};
  for (const k of allowed) if (req.body[k] !== undefined) fields[k] = req.body[k];
  db.updateContact(req.params.phone, fields);
  const updated = db.getContact(req.params.phone);
  broadcast('contact_updated', updated);
  res.json(updated);
});

app.post('/api/contacts/:phone/send', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    await sendAndSave(req.params.phone, text);
    const updated = db.getContact(req.params.phone);
    broadcast('refresh', { phone: req.params.phone, contact: updated });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contacts/:phone/gallery', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const { type } = req.body;
  const { MOSTRARIO, TESTIMONIOS } = require('./content');
  const { sendImage } = require('./whatsapp');
  const plantilla = type === 'mostrario' ? MOSTRARIO : TESTIMONIOS;
  const phone = req.params.phone;
  try {
    for (const url of plantilla.images) {
      await sendImage(phone, url);
      db.saveMessage(phone, 'out', 'image', url, '');
    }
    await sendAndSave(phone, plantilla.text);
    const updated = db.getContact(phone);
    broadcast('message', { contact: updated, direction: 'out', type: 'text', content: plantilla.text });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  res.json(db.getStats());
});

// ── Test endpoint (temporal) ───────────────────────────────────────────────────
app.post('/test/comprobante', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const { phone, buffer, mimeType } = req.body;
  if (!phone || !buffer) return res.status(400).json({ error: 'phone y buffer requeridos' });
  try {
    const payload = JSON.stringify({ buffer, mimeType: mimeType || 'image/jpeg' });
    await processMessage(phone, 'image', payload, `wamid.test_img_${Date.now()}`);
    const updated = db.getContact(phone);
    broadcast('refresh', { phone, contact: updated });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Remarketing Scheduler ──────────────────────────────────────────────────────
function colombiaHour() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })).getHours();
}

function startScheduler() {
  setInterval(async () => {
    if (!initialized) return;
    const h = colombiaHour();
    if (h >= 23 || h < 7) return;

    for (const c of db.getContactsForR1()) {
      try {
        await sendText(c.phone, R1_MESSAGE);
        db.saveMessage(c.phone, 'out', 'text', R1_MESSAGE, '');
        db.updateContact(c.phone, { r1_sent: 1, r1_sent_at: db.now() });
        broadcast('refresh', { phone: c.phone, contact: db.getContact(c.phone) });
      } catch (e) { console.error('R1 error', c.phone, e.message); }
    }

    for (const c of db.getContactsForR2()) {
      try {
        await sendText(c.phone, R2_MESSAGE);
        db.saveMessage(c.phone, 'out', 'text', R2_MESSAGE, '');
        db.updateContact(c.phone, { r2_sent: 1, r2_sent_at: db.now() });
        broadcast('refresh', { phone: c.phone, contact: db.getContact(c.phone) });
      } catch (e) { console.error('R2 error', c.phone, e.message); }
    }
  }, 2 * 60 * 1000);
}
