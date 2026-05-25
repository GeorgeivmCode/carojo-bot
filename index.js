require('dotenv').config();

process.on('uncaughtException', err => console.error('Uncaught:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

const express  = require('express');
const crypto   = require('crypto');
const path     = require('path');
const webpush  = require('web-push');

let vapidPublicKey = '';
let pushSubscriptions = [];

const app  = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const APP_SECRET     = process.env.WA_APP_SECRET;
const ADMIN_USER     = process.env.ADMIN_USER     || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const sseClients = new Set();

// Cola por telefono: evita condicion de carrera cuando llegan 2 mensajes simultaneos
const phoneQueues = new Map();
function enqueueForPhone(phone, fn) {
  const prev = phoneQueues.get(phone) || Promise.resolve();
  const next = prev.then(fn).catch(err => console.error(`Queue error [${phone}]:`, err.message));
  phoneQueues.set(phone, next);
  next.finally(() => { if (phoneQueues.get(phone) === next) phoneQueues.delete(phone); });
}

const AD_MAP = {
  '120224823866840501': { name: 'F1 - Messi',              campaign: 'Messi' },
  '120236759033280501': { name: 'V2 - Messi',              campaign: 'Messi' },
  '120245983517370501': { name: 'Tu propio dinero - LAL',  campaign: 'Carojo LAL' },
  '120245712723010501': { name: 'Emprende desde casa - LAL', campaign: 'Carojo LAL' },
  '120245712720490501': { name: '3200 mujeres - LAL',      campaign: 'Carojo LAL' },
};

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
let fireCapi, logSaleToSheets, notifyJorge;
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
    fireCapi       = flows.fireCapi;
    logSaleToSheets = flows.logSaleToSheets;
    notifyJorge    = flows.notifyJorge;
    console.log('flows OK');

    const content = require('./content');
    R1_MESSAGE = content.R1_MESSAGE;
    R2_MESSAGE = content.R2_MESSAGE;
    console.log('content OK');

    transcribeAudio = require('./transcribe').transcribeAudio;
    console.log('transcribe OK');

    initVapid();
    initialized = true;
    console.log('All modules loaded — bot is ready');

    startScheduler();
  } catch (err) {
    console.error('INIT ERROR:', err);
  }
}

// ── VAPID / Push ───────────────────────────────────────────────────────────────
function initVapid() {
  let pub  = db.getSetting('vapid_public');
  let priv = db.getSetting('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub  = keys.publicKey;
    priv = keys.privateKey;
    db.setSetting('vapid_public', pub);
    db.setSetting('vapid_private', priv);
    console.log('VAPID keys generadas y guardadas');
  }
  vapidPublicKey = pub;
  webpush.setVapidDetails('mailto:george.camaras@gmail.com', pub, priv);
  const stored = db.getSetting('push_subscriptions');
  if (stored) try { pushSubscriptions = JSON.parse(stored); } catch {}
  console.log(`Push suscripciones cargadas: ${pushSubscriptions.length}`);
}

async function sendPushToAll(payload) {
  const dead = [];
  for (const sub of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) dead.push(sub.endpoint);
      else console.error('Push error:', e.statusCode, e.body?.substring?.(0, 100));
    }
  }
  if (dead.length) {
    pushSubscriptions = pushSubscriptions.filter(s => !dead.includes(s.endpoint));
    db.setSetting('push_subscriptions', JSON.stringify(pushSubscriptions));
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

  // Referral y nombre se guardan antes de la cola (no afectan el estado del flujo)
  const referral = msg.referral;
  if (referral?.source_id || referral?.ctwa_clid) {
    console.log(`[referral] phone=${phone} source_id=${referral.source_id} ctwa_clid=${referral.ctwa_clid || 'none'}`);
    db.createContact(phone);
    const c = db.getContact(phone);
    const updates = {};
    if (referral.ctwa_clid && !c?.ctwa_clid) updates.ctwa_clid = referral.ctwa_clid;
    if (referral.source_id && !c?.ad_id) {
      updates.ad_id        = referral.source_id;
      updates.ad_name      = AD_MAP[referral.source_id]?.name || referral.headline || referral.source_id || '';
      updates.ad_image_url = referral.image_url || '';
    }
    if (Object.keys(updates).length) db.updateContact(phone, updates);
  }

  const profile = value.contacts?.[0]?.profile;
  if (profile?.name) {
    const c = db.getContact(phone);
    if (!c || c.name === '') db.updateContact(phone, { name: profile.name });
  }

  markRead(wamid);

  // Cola por telefono: mensajes del mismo numero se procesan uno a la vez
  enqueueForPhone(phone, async () => {
    const beforeState = db.getContact(phone)?.state || null;
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
    if (updated?.state === 'delivered' && beforeState !== 'delivered') {
      const saleData = { pack: updated.pack_selected || 'pack', name: updated.name || 'Cliente' };
      broadcast('sale', saleData);
      sendPushToAll(saleData).catch(() => {});
      console.log(`VENTA detectada: ${updated.name} - ${updated.pack_selected}`);
    }
    broadcast('refresh', { phone, contact: updated });
  });
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

app.post('/api/contacts/:phone/register-sale', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const { email, pack } = req.body;
  if (!email || !pack) return res.status(400).json({ error: 'email y pack requeridos' });
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  db.updateContact(phone, { state: 'delivered', tag: 'Facturado', pack_selected: pack, delivered_at: db.now(), email });
  const updated = db.getContact(phone);
  try { await fireCapi(updated, pack); } catch (e) { console.error('CAPI error:', e.message); }
  try { await logSaleToSheets(updated, pack, email); } catch (e) { console.error('Sheets error:', e.message); }
  try { await notifyJorge(updated, `VENTA MANUAL registrada!\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nNombre: ${updated.name || '-'}`); } catch {}
  broadcast('sale', { pack, name: updated.name || 'Cliente' });
  broadcast('refresh', { phone, contact: db.getContact(phone) });
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/approve-payment', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { PAYMENT_RECEIVED_ASK_EMAIL } = require('./content');
  db.updateContact(phone, { state: 'awaiting_email' });
  await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/change-email', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const { newEmail } = req.body;
  if (!newEmail) return res.status(400).json({ error: 'newEmail requerido' });
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (c.state !== 'delivered') return res.status(400).json({ error: 'El contacto no tiene entrega activa' });

  const pack = c.pack_selected || 'basico';
  const oldEmail = c.email || '';
  const { grantDriveAccess, revokeAccess, getFolderUrl } = require('./drive');

  try {
    await grantDriveAccess(newEmail, pack);
  } catch (e) {
    return res.status(500).json({ error: 'Error al dar acceso: ' + e.message });
  }

  if (oldEmail && oldEmail !== newEmail) {
    try { await revokeAccess(oldEmail, pack); } catch (e) { console.error('Revoke error:', e.message); }
  }

  db.updateContact(phone, { email: newEmail });
  const folderUrl = getFolderUrl(pack);
  await sendAndSave(phone,
    `Tu acceso fue actualizado!\n\nEnlace al pack ${pack}:\n${folderUrl}\n\nAbrelo con el correo ${newEmail}. Cualquier problema me avisas!`
  );
  await notifyJorge(c,
    `CAMBIO DE CORREO:\nTel: ${phone}\nNombre: ${c.name || '-'}\nPack: ${pack}\nAnterior: ${oldEmail || 'sin correo'}\nNuevo: ${newEmail}`
  );

  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true });
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

app.get('/api/vapid-key', (_req, res) => {
  res.json({ key: vapidPublicKey });
});

app.post('/api/push-subscribe', adminAuth, (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'invalid subscription' });
  const idx = pushSubscriptions.findIndex(s => s.endpoint === sub.endpoint);
  if (idx >= 0) pushSubscriptions[idx] = sub;
  else pushSubscriptions.push(sub);
  db.setSetting('push_subscriptions', JSON.stringify(pushSubscriptions));
  console.log(`Push suscripcion guardada. Total: ${pushSubscriptions.length}`);
  res.json({ ok: true });
});

app.post('/api/push-test', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const count = pushSubscriptions.length;
  if (!count) return res.status(400).json({ error: 'No hay suscripciones activas. Toca la campana en el panel.' });
  await sendPushToAll({ name: 'Prueba', pack: 'diamante', test: true });
  res.json({ ok: true, sent_to: count });
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

function colombiaDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

let lastKeepaliveDate = '';

function startScheduler() {
  setInterval(async () => {
    if (!initialized) return;
    const h = colombiaHour();
    if (h >= 23 || h < 7) return;

    // Keepalive diario a Jorge a las 8am para mantener ventana 24h abierta
    const today = colombiaDateStr();
    if (h === 8 && lastKeepaliveDate !== today && process.env.JORGE_PHONE) {
      lastKeepaliveDate = today;
      try {
        const stats = db.getStats();
        await sendText(process.env.JORGE_PHONE,
          `Resumen ${today}:\nTotal contactos: ${stats.total}\nVentas: ${stats.delivered}\nEsperando pago: ${stats.awaiting}\nNuevos hoy: ${stats.today}`
        );
        console.log('Keepalive Jorge enviado');
      } catch (e) { console.error('Keepalive Jorge error:', e.message); }
    }

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
