require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { sendText, getMediaUrl, downloadMedia } = require('./whatsapp');
const { processMessage, sendAndSave } = require('./flows');
const { R1_MESSAGE, R2_MESSAGE } = require('./content');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.WA_APP_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// SSE clients list
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  const [, pass] = Buffer.from(encoded, 'base64').toString().split(':');
  if (pass !== ADMIN_PASSWORD) return res.set('WWW-Authenticate', 'Basic realm="Admin"').sendStatus(401);
  next();
}

// ── Webhook ────────────────────────────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', verifySignature, async (req, res) => {
  res.sendStatus(200);

  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch { return; }

  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  if (!value) return;

  const messages = value.messages;
  if (!messages?.length) return;

  const msg = messages[0];
  const phone = msg.from;
  const wamid = msg.id;
  const msgType = msg.type;

  // Capture ctwa_clid from referral (Meta Ads attribution)
  const referral = msg.referral;
  if (referral?.ctwa_clid) {
    const contact = db.getContact(phone);
    if (!contact || !contact.ctwa_clid) {
      db.updateContact(phone, {
        ctwa_clid: referral.ctwa_clid,
        ad_id: referral.source_id || '',
        ad_name: referral.source_url || ''
      });
    }
  }

  // Capture contact name
  const profile = value.contacts?.[0]?.profile;
  if (profile?.name) {
    const existing = db.getContact(phone);
    if (!existing?.name) db.updateContact(phone, { name: profile.name });
    else if (existing.name === '') db.updateContact(phone, { name: profile.name });
  }

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
        const payload = JSON.stringify({
          buffer: buffer.toString('base64'),
          mimeType
        });
        content = payload;
        await processMessage(phone, 'image', payload, wamid);
      }

    } else if (msgType === 'audio' || msgType === 'video' || msgType === 'document') {
      content = `[${msgType}]`;
      await processMessage(phone, msgType, content, wamid);
    }
  } catch (err) {
    console.error('Error procesando mensaje:', err.message);
  }

  // Broadcast to SSE admin panel
  const updated = db.getContact(phone);
  broadcast('message', { contact: updated, direction: 'in', type: msgType, content });
});

// ── Admin SSE ──────────────────────────────────────────────────────────────────

app.get('/admin/events', adminAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');

  const interval = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 25000);

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(interval);
  });
});

// ── Admin REST API ─────────────────────────────────────────────────────────────

app.get('/api/contacts', adminAuth, (req, res) => {
  const { q, tag, filter } = req.query;
  let contacts;
  if (q) contacts = db.searchContacts(q);
  else if (tag) contacts = db.getContactsByTag(tag);
  else if (filter === 'unread') contacts = db.getUnreadContacts();
  else contacts = db.getAllContacts();
  res.json(contacts);
});

app.get('/api/contacts/:phone/messages', adminAuth, (req, res) => {
  const messages = db.getMessages(req.params.phone, 100);
  res.json(messages);
});

app.patch('/api/contacts/:phone', adminAuth, (req, res) => {
  const allowed = ['bot_active', 'tag', 'name', 'state', 'unread_count'];
  const fields = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) fields[k] = req.body[k];
  }
  db.updateContact(req.params.phone, fields);
  const updated = db.getContact(req.params.phone);
  broadcast('contact_updated', updated);
  res.json(updated);
});

app.post('/api/contacts/:phone/send', adminAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    await sendAndSave(req.params.phone, text);
    const updated = db.getContact(req.params.phone);
    broadcast('message', { contact: updated, direction: 'out', type: 'text', content: text });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', adminAuth, (req, res) => {
  res.json(db.getStats());
});

// ── Remarketing Scheduler ──────────────────────────────────────────────────────

function colombiaHour() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })).getHours();
}

function isBlackout() {
  const h = colombiaHour();
  return h >= 23 || h < 7;
}

setInterval(async () => {
  if (isBlackout()) return;

  // R1
  const r1List = db.getContactsForR1();
  for (const contact of r1List) {
    try {
      await sendText(contact.phone, R1_MESSAGE);
      db.saveMessage(contact.phone, 'out', 'text', R1_MESSAGE, '');
      db.updateContact(contact.phone, { r1_sent: 1, r1_sent_at: db.now() });
      broadcast('message', { contact, direction: 'out', type: 'text', content: R1_MESSAGE });
    } catch (e) {
      console.error('R1 error', contact.phone, e.message);
    }
  }

  // R2
  const r2List = db.getContactsForR2();
  for (const contact of r2List) {
    try {
      await sendText(contact.phone, R2_MESSAGE);
      db.saveMessage(contact.phone, 'out', 'text', R2_MESSAGE, '');
      db.updateContact(contact.phone, { r2_sent: 1, r2_sent_at: db.now() });
      broadcast('message', { contact, direction: 'out', type: 'text', content: R2_MESSAGE });
    } catch (e) {
      console.error('R2 error', contact.phone, e.message);
    }
  }
}, 2 * 60 * 1000); // every 2 minutes

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Carojo bot running on port ${PORT}`);
});
