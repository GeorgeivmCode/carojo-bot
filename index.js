require('dotenv').config();

process.on('uncaughtException', err => console.error('Uncaught:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

const express  = require('express');
const crypto   = require('crypto');
const path     = require('path');
const webpush  = require('web-push');
const { Jimp, JimpMime } = require('jimp');

// Miniatura liviana para mostrar en el chat del panel (no reemplaza el buffer original,
// que sigue guardandose completo para Vision y para el zoom/lightbox)
async function makeThumbnail(buffer, mimeType) {
  if (!mimeType || !mimeType.startsWith('image/')) return null;
  try {
    const img = await Jimp.read(buffer);
    img.resize({ w: 300 });
    const out = await img.getBuffer(JimpMime.jpeg, { quality: 55 });
    return out.toString('base64');
  } catch (e) {
    console.error('Thumbnail error:', e.message);
    return null;
  }
}

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

// Buffer para acumular partes de texto enviadas en rafaga
const textBuffers = new Map();

const AD_MAP = {
  '120224823866840501': { name: 'F1 - Messi',              campaign: 'Messi' },
  '120236759033280501': { name: 'V2 - Messi',              campaign: 'Messi' },
  '120245983517370501': { name: 'Tu propio dinero - LAL',  campaign: 'Carojo LAL' },
  '120245712723010501': { name: 'Emprende desde casa - LAL', campaign: 'Carojo LAL' },
  '120245712720490501': { name: '3200 mujeres - LAL',      campaign: 'Carojo LAL' },
  // Carojo Conversiones WA — Jun 2026
  '120247588642830501': { name: 'Carojo | Video timoteo',           campaign: 'Carojo Conversiones' },
  '120247588789980501': { name: 'Carojo | LT - James',              campaign: 'Carojo Conversiones' },
  '120247588686510501': { name: 'Carojo | LT - falcao',             campaign: 'Carojo Conversiones' },
  '120247588796700501': { name: 'Carojo | LT - Durazno pollito',    campaign: 'Carojo Conversiones' },
  '120247588717000501': { name: 'Carojo | LT - Amarillo pollito',   campaign: 'Carojo Conversiones' },
  '120247588810510501': { name: 'Carojo | Mientras duermen',        campaign: 'Carojo Conversiones' },
  '120247588615510501': { name: 'Carojo | Tu propio dinero',        campaign: 'Carojo Conversiones' },
  '120247588605700501': { name: 'Carojo | Hoy aprendes',            campaign: 'Carojo Conversiones' },
  '120247588611340501': { name: 'Carojo | 3200 mujeres',            campaign: 'Carojo Conversiones' },
  '120247588845440501': { name: 'Carojo | LT - Mujer sonriente',    campaign: 'Carojo Conversiones' },
  '120247588829570501': { name: 'Carojo | Sin dejar hijos',         campaign: 'Carojo Conversiones' },
  '120247588814300501': { name: 'Carojo | Transforma tu talento',   campaign: 'Carojo Conversiones' },
  '120247588843140501': { name: 'Carojo | LT - Verde menta manos',  campaign: 'Carojo Conversiones' },
  '120247588838170501': { name: 'Carojo | LT - Foto habitacion',    campaign: 'Carojo Conversiones' },
  '120247588833820501': { name: 'Carojo | LT - Mujer noche hojas',  campaign: 'Carojo Conversiones' },
  '120247588831150501': { name: 'Carojo | LT - Naranja pollito',    campaign: 'Carojo Conversiones' },
  '120247588824880501': { name: 'Carojo | LT - Lapices vertical',   campaign: 'Carojo Conversiones' },
  '120247588821080501': { name: 'Carojo | LT - Libro mesa plantas', campaign: 'Carojo Conversiones' },
  '120247588701850501': { name: 'Carojo | Emprende desde casa',     campaign: 'Carojo Conversiones' },
  '120247588808590501': { name: 'Carojo | LT - Verde aula hojas',   campaign: 'Carojo Conversiones' },
  '120247588805490501': { name: 'Carojo | LT - Mujer rizada',       campaign: 'Carojo Conversiones' },
  '120247588801610501': { name: 'Carojo | LT - Rosa salmon hojas',  campaign: 'Carojo Conversiones' },
  '120247588769300501': { name: 'Carojo | LT - Neon azul libro',    campaign: 'Carojo Conversiones' },
  '120247588746800501': { name: 'Carojo | LT - Libro arcoiris',     campaign: 'Carojo Conversiones' },
  '120247588730860501': { name: 'Carojo | LT - Lapices V2',         campaign: 'Carojo Conversiones' },
  '120247588668510501': { name: 'Carojo | LT - Libro mesa madera',  campaign: 'Carojo Conversiones' },
  '120247588656470501': { name: 'Carojo | Todo lo que necesitas',   campaign: 'Carojo Conversiones' },
  '120247588625680501': { name: 'Carojo | Sin jefe',                campaign: 'Carojo Conversiones' },
  '120247588620270501': { name: 'Carojo | LT - Verde agua hojas',   campaign: 'Carojo Conversiones' },
  '120247588602260501': { name: 'Carojo | LT - Lila hojas',         campaign: 'Carojo Conversiones' },
  // Carojo | Ventas WA | Intereses | Jun 2026
  '120247971694870501': { name: 'AIDA3 - lila_hojas',     campaign: 'Carojo' },
  '120247971692050501': { name: 'AIDA2 - todo_necesitas', campaign: 'Carojo' },
  '120247971685450501': { name: 'AIDA1 - hoy_aprendes',   campaign: 'Carojo' },
  '120247971693810501': { name: 'AIDA2 - transforma',     campaign: 'Carojo' },
  '120247971670950501': { name: 'MV1 - todo_necesitas',   campaign: 'Carojo' },
  '120247971700620501': { name: 'PAS1 - lila_hojas',      campaign: 'Carojo' },
  '120247971675320501': { name: 'MV2 - todo_necesitas',   campaign: 'Carojo' },
  '120247971671550501': { name: 'MV1 - transforma',       campaign: 'Carojo' },
  '120247971712620501': { name: 'PAS2 - transforma',      campaign: 'Carojo' },
  '120247971696060501': { name: 'AIDA3 - rosa_lapices',   campaign: 'Carojo' },
  '120247971709090501': { name: 'PAS2 - rosa_lapices',    campaign: 'Carojo' },
  '120247971690100501': { name: 'AIDA2 - rosa_lapices',   campaign: 'Carojo' },
  '120247971691060501': { name: 'AIDA2 - hoy_aprendes',   campaign: 'Carojo' },
  '120247971710460501': { name: 'PAS2 - hoy_aprendes',    campaign: 'Carojo' },
  '120247971711580501': { name: 'PAS2 - todo_necesitas',  campaign: 'Carojo' },
  '120247971688590501': { name: 'AIDA2 - lila_hojas',     campaign: 'Carojo' },
  '120247971705880501': { name: 'PAS1 - todo_necesitas',  campaign: 'Carojo' },
  '120247971681740501': { name: 'MV3 - transforma',       campaign: 'Carojo' },
  '120247971703990501': { name: 'PAS1 - hoy_aprendes',    campaign: 'Carojo' },
  '120247971706930501': { name: 'PAS1 - transforma',      campaign: 'Carojo' },
  '120247971674290501': { name: 'MV2 - hoy_aprendes',     campaign: 'Carojo' },
  '120247971676270501': { name: 'MV2 - transforma',       campaign: 'Carojo' },
  '120247971677160501': { name: 'MV3 - lila_hojas',       campaign: 'Carojo' },
  '120247971678840501': { name: 'MV3 - rosa_lapices',     campaign: 'Carojo' },
  '120247971679850501': { name: 'MV3 - hoy_aprendes',     campaign: 'Carojo' },
  '120247971683240501': { name: 'AIDA1 - lila_hojas',     campaign: 'Carojo' },
  '120247971698640501': { name: 'AIDA3 - todo_necesitas', campaign: 'Carojo' },
  '120247971699490501': { name: 'AIDA3 - transforma',     campaign: 'Carojo' },
  '120247971702500501': { name: 'PAS1 - rosa_lapices',    campaign: 'Carojo' },
  '120247971707970501': { name: 'PAS2 - lila_hojas',      campaign: 'Carojo' },
  '120247971672780501': { name: 'MV2 - lila_hojas',       campaign: 'Carojo' },
  '120247971673580501': { name: 'MV2 - rosa_lapices',     campaign: 'Carojo' },
  '120247971680540501': { name: 'MV3 - todo_necesitas',   campaign: 'Carojo' },
  '120247971686460501': { name: 'AIDA1 - todo_necesitas', campaign: 'Carojo' },
  '120247971697310501': { name: 'AIDA3 - hoy_aprendes',   campaign: 'Carojo' },
  '120247971668160501': { name: 'MV1 - lila_hojas',       campaign: 'Carojo' },
  '120247971669640501': { name: 'MV1 - hoy_aprendes',     campaign: 'Carojo' },
  '120247971684520501': { name: 'AIDA1 - rosa_lapices',   campaign: 'Carojo' },
  '120247971687610501': { name: 'AIDA1 - transforma',     campaign: 'Carojo' },
  '120247971668910501': { name: 'MV1 - rosa_lapices',     campaign: 'Carojo' },
};

// ── Arrange Express BEFORE loading heavy modules ───────────────────────────────
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ ok: true, initialized }));
app.get('/', (_req, res) => res.send('<!DOCTYPE html><html><head><meta name="facebook-domain-verification" content="clgru5a4p4a25bab2t5ose7aecavdz" /></head><body></body></html>'));

// Endpoint requerido por Meta para eliminacion de datos de usuario
app.get('/data-deletion', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Eliminación de datos - Carojo Aprende y Emprende</title></head><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
<h2>Solicitud de eliminación de datos</h2>
<p>Si deseas que eliminemos tus datos de nuestra plataforma, envíanos un mensaje de WhatsApp al número <strong>+57 324 4971371</strong> indicando "Eliminar mis datos".</p>
<p>Procesaremos tu solicitud en un plazo máximo de 30 días y eliminaremos tu nombre, número de teléfono, correo electrónico e historial de conversación de nuestros sistemas.</p>
<p>Para más información escríbenos a <a href="mailto:george.camaras@gmail.com">george.camaras@gmail.com</a></p>
</body></html>`);
});

// Callback POST de Meta para eliminacion de datos (signed_request)
app.post('/data-deletion', express.urlencoded({ extended: true }), (req, res) => {
  const { signed_request } = req.body || {};
  if (signed_request) {
    const [, payload] = signed_request.split('.');
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64').toString());
      const uid = data.user_id || 'unknown';
      console.log(`Data deletion request for user: ${uid}`);
    } catch (_) {}
  }
  res.json({ url: 'https://carojo-bot.onrender.com/data-deletion', confirmation_code: `DEL-${Date.now()}` });
});

// Start listening immediately so Render health check passes
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  init();
});

// ── Lazy-loaded modules ────────────────────────────────────────────────────────
let db, sendText, markRead, getMediaUrl, downloadMedia, processMessage, sendAndSave, transcribeAudio;
let fireCapi, logSaleToSheets, notifyJorge, generateAccessToken;
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
    generateAccessToken = flows.generateAccessToken;
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
function afterProcess(phone, beforeState) {
  const updated = db.getContact(phone);
  if (updated?.state === 'delivered' && beforeState !== 'delivered') {
    const saleData = { pack: updated.pack_selected || 'pack', name: updated.name || 'Cliente' };
    broadcast('sale', saleData);
    sendPushToAll(saleData).catch(() => {});
    console.log(`VENTA detectada: ${updated.name} - ${updated.pack_selected}`);
  }
  if (updated?.state === 'old_client' && beforeState !== 'old_client') {
    const oldClientData = { type: 'old_client', name: updated.name || 'Cliente', phone };
    broadcast('old_client', oldClientData);
    sendPushToAll(oldClientData).catch(() => {});
    console.log(`CLIENTE ANTIGUO detectado: ${updated.name || phone}`);
  }
  broadcast('refresh', { phone, contact: updated });
}

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

// Brute-force protection: max 10 failed attempts per IP per 15 min
const failedAttempts = new Map();
function checkBruteForce(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip) || { count: 0, first: now };
  if (now - entry.first > 15 * 60 * 1000) { failedAttempts.delete(ip); return false; }
  return entry.count >= 10;
}
function recordFailure(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip) || { count: 0, first: now };
  if (now - entry.first > 15 * 60 * 1000) { failedAttempts.set(ip, { count: 1, first: now }); return; }
  entry.count++;
  failedAttempts.set(ip, entry);
}

function adminAuth(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
  if (checkBruteForce(ip)) return res.status(429).send('Too many attempts. Try again in 15 minutes.');
  const auth = req.headers['authorization'] || '';
  const [type, encoded] = auth.split(' ');
  if (type !== 'Basic' || !encoded) {
    recordFailure(ip);
    return res.set('WWW-Authenticate', 'Basic realm="Admin"').sendStatus(401);
  }
  const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    recordFailure(ip);
    return res.set('WWW-Authenticate', 'Basic realm="Admin"').sendStatus(401);
  }
  next();
}

function adminAuthMedia(req, res, next) {
  // Acepta Basic header (apiFetch) o ?token=base64(user:pass) (para <video src>)
  let user, pass;
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Basic ')) {
    try { [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':'); } catch {}
  } else if (req.query.token) {
    try { [user, pass] = Buffer.from(req.query.token, 'base64').toString().split(':'); } catch {}
  }
  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) return res.sendStatus(401);
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
  if (!initialized) return res.sendStatus(503); // Meta reintenta automaticamente
  res.sendStatus(200);

  let body;
  try { body = JSON.parse(req.body.toString()); } catch { return; }

  const value = body?.entry?.[0]?.changes?.[0]?.value;

  // Status updates (enviado/entregado/leido/fallido)
  if (value?.statuses?.length) {
    for (const s of value.statuses) {
      const wamid = s.id;
      const status = s.status; // sent, delivered, read, failed
      const phone  = s.recipient_id;
      console.log(`[STATUS] ${status} | phone=${phone} | wamid=${wamid}`);
      if (initialized) {
        db.updateMessageStatus(wamid, status);
        broadcast('msg_status', { phone, wamid, status });
      }
    }
  }

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

  if (msgType === 'text') {
    // Guardar en DB inmediatamente para que el panel admin lo vea al instante
    if (!db.getContact(phone)) db.createContact(phone);
    const cNow = db.getContact(phone);
    const textContent = msg.text?.body || '';
    const replyTo = msg.context?.id || '';
    db.saveMessage(phone, 'in', 'text', textContent, wamid, replyTo);
    db.updateContact(phone, {
      last_message:    textContent.substring(0, 200),
      last_message_at: db.now(),
      unread_count:    (cNow.unread_count || 0) + 1
    });
    broadcast('refresh', { phone, contact: db.getContact(phone) });

    // Acumular partes del mismo telefono y esperar 1.5s de silencio antes de procesar
    if (!textBuffers.has(phone)) textBuffers.set(phone, { parts: [], timer: null });
    const buf = textBuffers.get(phone);
    buf.parts.push(textContent);
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
      const combined = buf.parts.join('\n');
      textBuffers.delete(phone);
      enqueueForPhone(phone, async () => {
        const beforeState = db.getContact(phone)?.state || null;
        try {
          await processMessage(phone, 'text', combined, wamid, { skipSave: true });
        } catch (err) {
          console.error('Webhook handler error:', err.message);
        }
        afterProcess(phone, beforeState);
      });
    }, 3000);

  } else {
    // Imagen, audio, video, documento — procesar inmediatamente en cola
    enqueueForPhone(phone, async () => {
      const beforeState = db.getContact(phone)?.state || null;
      try {
        if (msgType === 'image') {
          const mediaId = msg.image?.id;
          if (mediaId) {
            const mediaUrl = await getMediaUrl(mediaId);
            const { buffer, mimeType } = await downloadMedia(mediaUrl);
            const thumb = await makeThumbnail(buffer, mimeType);
            const payload = JSON.stringify({ buffer: buffer.toString('base64'), mimeType, thumb });
            await processMessage(phone, 'image', payload, wamid);
          }
        } else if (msgType === 'audio') {
          const mediaId = msg.audio?.id;
          if (mediaId) {
            try {
              const mediaUrl = await getMediaUrl(mediaId);
              const { buffer, mimeType } = await downloadMedia(mediaUrl);
              const transcription = await transcribeAudio(buffer, mimeType);
              console.log(`Audio transcrito [${phone}]: ${transcription.substring(0, 80)}`);
              // Guardar como tipo 'audio' con la transcripcion — panel lo muestra con icono 🎤
              db.saveMessage(phone, 'in', 'audio', transcription, wamid);
              db.updateContact(phone, { last_message: `🎤 ${transcription.substring(0, 100)}`, last_message_at: db.now(), unread_count: (db.getContact(phone)?.unread_count || 0) + 1 });
              broadcast('refresh', { phone, contact: db.getContact(phone) });
              await processMessage(phone, 'text', transcription, wamid, { skipSave: true });
            } catch (e) {
              console.error('Transcripcion error:', e.message);
              db.saveMessage(phone, 'in', 'audio', '[audio no transcrito]', wamid);
              await processMessage(phone, 'text', '[audio]', wamid, { skipSave: true });
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
              const finalMime = resolvedMime || mime;
              const thumb = await makeThumbnail(buffer, finalMime);
              const payload = JSON.stringify({ buffer: buffer.toString('base64'), mimeType: finalMime, thumb });
              await processMessage(phone, 'image', payload, wamid);
            } catch (e) {
              console.error('Document download error:', e.message);
              await processMessage(phone, 'document', '[documento]', wamid);
            }
          } else {
            await processMessage(phone, 'document', '[documento]', wamid);
          }
        } else if (msgType === 'video') {
          const mediaId = msg.video?.id;
          const payload = mediaId ? JSON.stringify({ mediaId }) : '[video]';
          await processMessage(phone, 'video', payload, wamid);
        }
      } catch (err) {
        console.error('Webhook handler error:', err.message);
      }
      afterProcess(phone, beforeState);
    });
  }
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
  const { q, tag, filter, date } = req.query;
  if (q)                    return res.json(db.searchContacts(q));
  if (tag)                  return res.json(db.getContactsByTag(tag));
  if (filter === 'unread')  return res.json(db.getUnreadContacts());
  if (filter === 'today')   return res.json(db.getContactsToday());
  if (date)                 return res.json(db.getContactsByDate(date));
  res.json(db.getAllContacts());
});

app.get('/api/contacts/:phone/messages', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const beforeId = req.query.before ? parseInt(req.query.before, 10) : null;
  res.json(db.getMessages(req.params.phone, 50, beforeId));
});

app.patch('/api/contacts/:phone', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const allowed = ['bot_active', 'tag', 'name', 'state', 'unread_count', 'folder_id'];
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

  const { grantDriveAccess } = require('./drive');
  const { deliveryMessage } = require('./content');

  // 1. Dar acceso Drive
  let regFolderId = '';
  try { const dr = await grantDriveAccess(email, pack); regFolderId = dr.folderId || ''; } catch (e) { console.error('Drive error register-sale:', e.message); }
  // 2. Enviar mensaje de entrega con pixel URL
  try {
    const token = generateAccessToken(phone, pack);
    const accessUrl = `https://bot.carojo.uk/acceso/${token}`;
    await sendAndSave(phone, deliveryMessage(pack, accessUrl, email));
  } catch (e) { console.error('Delivery msg error:', e.message); }
  // 3. Actualizar DB
  db.updateContact(phone, { state: 'delivered', tag: 'Facturado', pack_selected: pack, delivered_at: db.now(), email, folder_id: regFolderId });
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
  if (!c.pack_selected) return res.status(400).json({ error: 'El contacto no tiene pack registrado' });

  const pack = c.pack_selected;
  const oldEmail = c.email || '';
  const { grantDriveAccess, revokeAccess, getFolderUrl } = require('./drive');

  let chEmailFolderId = '';
  try {
    const dr = await grantDriveAccess(newEmail, pack);
    chEmailFolderId = dr.folderId || '';
  } catch (e) {
    return res.status(500).json({ error: 'Error al dar acceso: ' + e.message });
  }

  let revokeOk = true;
  if (oldEmail && oldEmail !== newEmail) {
    try {
      await revokeAccess(oldEmail, pack, c.folder_id || null);
    } catch (e) {
      console.error('Revoke error:', e.message);
      revokeOk = false;
    }
  }

  db.updateContact(phone, { email: newEmail, folder_id: chEmailFolderId });
  const folderUrl = getFolderUrl(pack, chEmailFolderId);
  await sendAndSave(phone,
    `Tu acceso fue actualizado!\n\nEnlace al pack ${pack}:\n${folderUrl}\n\nAbrelo con el correo ${newEmail}. Cualquier problema me avisas!`
  );

  const revokeNote = revokeOk ? '' : `\n\nALERTA: No se pudo revocar el correo anterior (${oldEmail}). Revocalo manualmente desde el panel.`;
  await notifyJorge(c,
    `CAMBIO DE CORREO:\nTel: ${phone}\nNombre: ${c.name || '-'}\nPack: ${pack}\nAnterior: ${oldEmail || 'sin correo'}\nNuevo: ${newEmail}${revokeNote}`
  );

  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true, revokeOk, oldEmail: revokeOk ? undefined : oldEmail });
});

app.post('/api/contacts/:phone/restore-access', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const { pack, email } = req.body;
  const validPacks = ['basico', 'oro', 'diamante'];
  if (!pack || !validPacks.includes(pack)) return res.status(400).json({ error: 'pack invalido (basico/oro/diamante)' });
  if (!email || !email.includes('@gmail.com')) return res.status(400).json({ error: 'email debe ser Gmail' });
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { grantDriveAccess, getFolderUrl } = require('./drive');
  const { deliveryMessage } = require('./content');
  let restoreFolderId = '';
  try {
    const dr = await grantDriveAccess(email, pack);
    restoreFolderId = dr.folderId || '';
  } catch (e) {
    return res.status(500).json({ error: 'Error al dar acceso Drive: ' + e.message });
  }
  await sendAndSave(phone, deliveryMessage(pack, getFolderUrl(pack, restoreFolderId), email));
  // NO se setea delivered_at para que no sume en el contador de ventas de hoy
  // NO usa pixel URL — no es venta nueva, no debe disparar Purchase en Meta
  db.updateContact(phone, { state: 'delivered', tag: 'Soporte', pack_selected: pack, email, folder_id: restoreFolderId });
  await notifyJorge(c, `ACCESO RESTAURADO (cliente antiguo)\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nNombre: ${c.name || '-'}`);
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/send-gift', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const { gift } = req.body;
  const GIFT_URLS = {
    resina:      'https://drive.google.com/drive/folders/1iZ6y6PtYg5APKftiR4296bT8i2rlJG0L',
    globoflexia: 'https://drive.google.com/drive/folders/1YyTR18FTIR5vhmISZ6IPgTRFs5mnqW98',
    bordados:    'https://drive.google.com/drive/u/0/folders/1XpP3s7KXEnOUDizYTxlTN8jkry_uSQEY'
  };
  const GIFT_MSGS = {
    resina:      'Tu curso de regalo *Arte en Resina Epoxica* ya esta activo! 🌟\n\nCon este curso vas a aprender a crear piezas unicas en resina — desde aretes y accesorios hasta cuadros decorativos que puedes vender. Es un negocio increible que complementa perfecto el lettering!\n\nAqui esta tu acceso:',
    globoflexia: 'Tu curso de regalo *Globoflexia y Decoracion* ya esta activo! 🎈\n\nCon este curso vas a aprender a hacer arreglos, figuras y decoraciones con globos — un servicio muy solicitado para fiestas y eventos que te puede dar ingresos desde el primer fin de semana!\n\nAqui esta tu acceso:',
    bordados:    'Tu curso de regalo *Bordados Florales* ya esta activo! 🌸\n\nCon este curso vas a aprender bordados a mano con flores, hojas y texturas — piezas que tienen muchisima demanda en mercados y tiendas en linea. Perfecto para combinar con tu arte en lettering!\n\nAqui esta tu acceso:'
  };
  if (!gift || !GIFT_MSGS[gift]) return res.status(400).json({ error: 'Regalo invalido (resina/globoflexia/bordados)' });
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  const msg = `${GIFT_MSGS[gift]}\n\n${GIFT_URLS[gift]}\n\nAbrelo con el correo que usaste para el pack. Cualquier cosa me cuentas aqui! 💛`;
  await sendAndSave(phone, msg);
  db.updateContact(phone, { gift_sent: 1 });
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/revoke-access', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (!c.email || !c.pack_selected) return res.status(400).json({ error: 'sin email o pack registrado' });
  const { revokeAccess } = require('./drive');
  let driveError = null;
  try { await revokeAccess(c.email, c.pack_selected, c.folder_id || null); } catch (e) {
    driveError = e.message;
    console.error('revokeAccess Drive error:', e.message);
  }
  db.updateContact(phone, { state: 'awaiting_comprobante', tag: 'Acceso revocado' });
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  if (driveError) {
    res.json({ ok: true, warning: 'Estado actualizado pero Drive no respondió: ' + driveError });
  } else {
    res.json({ ok: true });
  }
});

app.post('/api/contacts/:phone/unblock-access', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  // Si tiene email y pack, restaurar Drive tambien
  let unblockFolderId = c.folder_id || '';
  if (c.email && c.pack_selected) {
    const { grantDriveAccess } = require('./drive');
    try {
      const dr = await grantDriveAccess(c.email, c.pack_selected);
      unblockFolderId = dr.folderId || unblockFolderId;
    } catch (e) {
      console.error('Unblock Drive error:', e.message);
    }
  }
  // Determinar estado correcto segun si ya habia comprado o no
  const newState = c.delivered_at ? 'delivered' : 'awaiting_comprobante';
  const newTag   = c.delivered_at ? 'Facturado' : 'Sin etiqueta';
  db.updateContact(phone, { state: newState, tag: newTag, bot_active: 1, folder_id: unblockFolderId });
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/change-pack', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { pack } = req.body;
  if (!['basico', 'oro', 'diamante'].includes(pack)) return res.status(400).json({ error: 'pack invalido' });
  const email = c.email;
  if (!email) return res.status(400).json({ error: 'el cliente no tiene Gmail registrado' });
  const { grantDriveAccess, revokeAccess } = require('./drive');
  // Dar acceso al pack nuevo primero
  let chPackFolderId = '';
  try {
    const dr = await grantDriveAccess(email, pack);
    chPackFolderId = dr.folderId || '';
  } catch (e) {
    return res.status(500).json({ error: 'Error dando acceso Drive: ' + e.message });
  }
  // Revocar pack anterior si es diferente
  let revokeOk = true;
  const oldPack = c.pack_selected;
  if (oldPack && oldPack !== pack) {
    try {
      await revokeAccess(email, oldPack, c.folder_id || null);
    } catch (e) {
      console.error('Revoke change-pack:', e.message);
      revokeOk = false;
    }
  }
  db.updateContact(phone, { pack_selected: pack, state: 'delivered', tag: 'Facturado', folder_id: chPackFolderId });
  // Reenviar mensaje de entrega con nuevo pack
  const { generateAccessToken } = require('./flows');
  const { deliveryMessage } = require('./content');
  const accessToken = generateAccessToken(phone, pack);
  const accessUrl = `https://bot.carojo.uk/acceso/${accessToken}`;
  try {
    await sendAndSave(phone, deliveryMessage(pack, accessUrl, email));
  } catch (e) { console.error('Send change-pack delivery:', e.message); }
  if (!revokeOk) {
    await notifyJorge(c,
      `ALERTA CAMBIO PACK:\nTel: ${phone}\nNombre: ${c.name || '-'}\nPack anterior: ${oldPack}\nPack nuevo: ${pack}\nNo se pudo revocar el acceso al pack anterior. Revocalo manualmente.`
    ).catch(() => {});
  }
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true, revokeOk, oldPack: revokeOk ? undefined : oldPack });
});

app.post('/api/messages/:id/mark-golden', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalido' });
  db.markGolden(id);
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/mark-fraud', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { revokeAccess } = require('./drive');
  const { sendText } = require('./whatsapp');
  // Revocar Drive si tiene email y pack
  if (c.email && c.pack_selected) {
    try { await revokeAccess(c.email, c.pack_selected, c.folder_id || null); } catch (e) { console.error('Revoke Drive fraud:', e.message); }
  }
  // Bloquear contacto
  db.updateContact(phone, { bot_active: 0, state: 'fraud', tag: 'Fraude' });
  // Notificar a Jorge
  try {
    await sendText(process.env.JORGE_PHONE,
      `FRAUDE DETECTADO:\nTel: ${phone}\nNombre: ${c.name || '-'}\nEmail: ${c.email || '-'}\nPack: ${c.pack_selected || '-'}\nAcceso Drive revocado.`
    );
  } catch (e) { console.error('Notify fraud:', e.message); }
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/mark-test-sale', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  // Toggle: si ya esta marcada como Prueba, revertir a Facturado (vuelve a contar)
  const newTag = c.tag === 'Prueba' ? 'Facturado' : 'Prueba';
  db.updateContact(phone, { tag: newTag });
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true, tag: newTag });
});

app.post('/api/contacts/:phone/send', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    await sendAndSave(req.params.phone, text);
    db.updateContact(req.params.phone, {
      last_message: text.substring(0, 200),
      last_message_at: db.now()
    });
    const updated = db.getContact(req.params.phone);
    res.json({ ok: true });
    broadcast('refresh', { phone: req.params.phone, contact: updated });
  } catch (err) {
    const waErr = err?.response?.data?.error;
    const code  = waErr?.code;
    const title = waErr?.error_data?.details || waErr?.message || err.message;
    const blocked = code === 131026 || (title || '').toLowerCase().includes('undeliverable');
    res.status(500).json({
      error: blocked
        ? 'Esta persona te bloqueó en WhatsApp. No se puede enviar el mensaje.'
        : err.message
    });
  }
});

app.post('/api/contacts/:phone/gallery', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const { type } = req.body;
  const { MOSTRARIO, TESTIMONIOS } = require('./content');
  const { sendGallery } = require('./flows');
  const plantilla = type === 'mostrario' ? MOSTRARIO : TESTIMONIOS;
  const phone = req.params.phone;
  try {
    await sendGallery(phone, plantilla);
    db.updateContact(phone, type === 'mostrario' ? { mostrario_sent: 1 } : { testimonios_sent: 1 });
    const updated = db.getContact(phone);
    broadcast('refresh', { phone, contact: updated });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let statsCache = null;
let statsCacheAt = 0;
app.get('/api/stats', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const now = Date.now();
  if (!statsCache || now - statsCacheAt > 8000) {
    statsCache = db.getStats();
    statsCacheAt = now;
  }
  res.json(statsCache);
});

// Historial crudo de eventos de Hotmart (ventas, boletos pendientes, cancelaciones, etc.)
// Util para auditar/backfillear CAPI sin depender de lo que Hotmart todavia muestre en /sales/history.
app.get('/api/hotmart-events', adminAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  res.json(db.getHotmartEvents(limit));
});

app.get('/api/vapid-key', (_req, res) => {
  res.json({ key: vapidPublicKey });
});

app.get('/api/video/:wamid', adminAuthMedia, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const msg = db.getMessageByWamid(req.params.wamid);
  if (!msg) return res.status(404).json({ error: 'not found' });
  let parsed;
  try { parsed = JSON.parse(msg.content); } catch { return res.status(400).json({ error: 'invalid content' }); }
  if (!parsed.mediaId) return res.status(400).json({ error: 'no mediaId' });
  try {
    const mediaUrl = await getMediaUrl(parsed.mediaId);
    const { buffer, mimeType } = await downloadMedia(mediaUrl);
    res.set('Content-Type', mimeType || 'video/mp4');
    res.set('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (e) {
    console.error('Video proxy error:', e.message);
    res.status(500).json({ error: 'no se pudo obtener el video' });
  }
});

app.get('/api/video-recover/:wamid', adminAuthMedia, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const { wamid } = req.params;
  const msg = db.getMessageByWamid(wamid);
  if (!msg) return res.status(404).json({ error: 'mensaje no encontrado' });

  // Si ya tiene mediaId guardado, redirigir al endpoint normal
  try {
    const parsed = JSON.parse(msg.content);
    if (parsed.mediaId) {
      const mediaUrl = await getMediaUrl(parsed.mediaId);
      const { buffer, mimeType } = await downloadMedia(mediaUrl);
      res.set('Content-Type', mimeType || 'video/mp4');
      res.set('Cache-Control', 'no-store');
      return res.send(buffer);
    }
  } catch {}

  // Intentar recuperar mediaId desde la Graph API usando el wamid
  try {
    const axios = require('axios');
    const apiRes = await axios.get(`https://graph.facebook.com/v21.0/${wamid}`, {
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` },
      params: { fields: 'id,type,video' }
    });
    const mediaId = apiRes.data?.video?.id;
    if (!mediaId) return res.status(404).json({ error: 'Meta no devolvio mediaId para este video' });

    // Guardar en DB para futuros accesos
    db.updateMessageContent(wamid, JSON.stringify({ mediaId }));

    const mediaUrl = await getMediaUrl(mediaId);
    const { buffer, mimeType } = await downloadMedia(mediaUrl);
    res.set('Content-Type', mimeType || 'video/mp4');
    res.set('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (e) {
    console.error('Video recover error:', e.response?.data || e.message);
    res.status(404).json({ error: 'video no disponible' });
  }
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

// ── Pixel Purchase Page ────────────────────────────────────────────────────────
const DRIVE_URLS_PIXEL = {
  basico:   'https://drive.google.com/drive/folders/11REC3PBrfb35NaGpShELpo5X0mekJLuw',
  oro:      'https://drive.google.com/drive/folders/1c41mpvOdASqG3am1uZ5eSQbZuc4gS2LX',
  diamante: 'https://drive.google.com/drive/folders/1t3qNyssHh2UqQ9dIIH4dJl1TlkDDatT4'
};
const PACK_NAMES_PIXEL = { basico: 'Pack Basico', oro: 'Pack Oro', diamante: 'Pack Diamante' };
const PIXEL_ID = process.env.META_PIXEL_ID || '1045311689986665';

// Evita disparar CAPI website mas de una vez por cliente (se resetea con restart del server)
const capiPageFired = new Set();

async function fireCapiWebsitePurchase({ phone, pack, amount, ip, ua, eventId, fbc, ctwaClid, email }) {
  const CAPI_TOKEN = process.env.META_CAPI_TOKEN;
  if (!PIXEL_ID || !CAPI_TOKEN) return;
  const sha256 = v => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
  const ud = {};
  if (ip) ud.client_ip_address = ip;
  if (ua) ud.client_user_agent = ua;
  ud.ph = [sha256(phone.replace(/\D/g, ''))];
  if (email) ud.em = [sha256(email)];
  if (fbc) ud.fbc = fbc;
  if (ctwaClid) ud.ctwa_clid = ctwaClid;
  const event = {
    event_name:       'Purchase',
    event_time:       Math.floor(Date.now() / 1000),
    action_source:    'website',
    event_source_url: 'https://carojo-bot.onrender.com/acceso/',
    event_id:         eventId,
    user_data:        ud,
    custom_data: {
      currency: 'COP', value: amount,
      content_name: PACK_NAMES_PIXEL[pack] || pack,
      content_type: 'product', content_ids: [pack],
      contents: [{ id: pack, quantity: 1 }]
    }
  };
  const axiosLib = require('axios');
  const r = await axiosLib.post(
    `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`,
    { data: [event] },
    { params: { access_token: CAPI_TOKEN }, timeout: 8000 }
  );
  console.log(`CAPI website ok [${phone}] ip=${ip ? 'si' : 'no'} ua=${ua ? 'si' : 'no'}:`, JSON.stringify(r.data));
}

// ── Webhook Hotmart → CAPI Creciendo con Fe ────────────────────────────────────
const HOTMART_HOTTOK      = process.env.HOTMART_HOTTOK;
const HOTMART_PRODUCT_ID  = 7482775; // Educa con Fe (Creciendo con Fe)
const CONFE_PIXEL_ID      = '874282268605387'; // Creciendo con Fe - Pixel
const hotmartFired = new Set(); // dedupe Purchase por transaction, se resetea con restart del server
const hotmartCheckoutFired = new Set(); // dedupe InitiateCheckout (boleto/recibo) por transaction

// ucode = identificador único de comprador que manda Hotmart en cada venta.
// Meta lo usa como external_id para mejorar el match del comprador (EMQ).
function buildHotmartUserData({ email, phoneCode, phone, fbc, ucode, name }) {
  const sha256 = v => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
  const ud = {};
  if (email) ud.em = [sha256(email)];
  if (phone) ud.ph = [sha256(`${phoneCode || ''}${phone}`.replace(/\D/g, ''))];
  if (fbc) ud.fbc = fbc;
  if (ucode) ud.external_id = [sha256(ucode)];
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts[0]) ud.fn = [sha256(parts[0])];
    if (parts.length > 1) ud.ln = [sha256(parts[parts.length - 1])];
  }
  return ud;
}

async function postHotmartCapiEvent({ eventName, eventId, orderDateMs, amount, currency, ud }) {
  const CAPI_TOKEN = process.env.META_CAPI_TOKEN;
  if (!CONFE_PIXEL_ID || !CAPI_TOKEN) return;
  const event = {
    event_name:       eventName,
    event_time:       Math.floor((orderDateMs || Date.now()) / 1000),
    action_source:    'website',
    event_source_url: 'https://creciendoconfe.lovable.app/',
    event_id:         eventId,
    user_data:        ud,
    custom_data: { currency: currency || 'USD', value: amount }
  };
  const axiosLib = require('axios');
  const r = await axiosLib.post(
    `https://graph.facebook.com/v21.0/${CONFE_PIXEL_ID}/events`,
    { data: [event] },
    { params: { access_token: CAPI_TOKEN }, timeout: 8000 }
  );
  console.log(`CAPI Hotmart ${eventName} ok [${eventId}]:`, JSON.stringify(r.data));
}

async function fireCapiHotmartPurchase({ transaction, email, phoneCode, phone, amount, currency, orderDateMs, fbc, ucode, name }) {
  const ud = buildHotmartUserData({ email, phoneCode, phone, fbc, ucode, name });
  // event_id se deja EXACTAMENTE igual a `transaction` (sin cambios) para no romper
  // la deduplicacion de Meta si Hotmart reintenta un webhook ya procesado antes de este cambio.
  await postHotmartCapiEvent({ eventName: 'Purchase', eventId: transaction, orderDateMs, amount, currency, ud });
}

// Dispara cuando alguien pide el boleto/recibo para pagar en efectivo (PURCHASE_BILLET_PRINTED).
// Todavia no completo el pago, pero ya mostro intencion real de compra -- sirve como InitiateCheckout
// para que Meta tenga esta señal temprano, sobre todo porque los pagos tipo boleto/voucher a veces
// nunca disparan el pixel del navegador (la persona paga fuera de la sesion original).
async function fireCapiHotmartCheckout({ transaction, email, phoneCode, phone, amount, currency, orderDateMs, ucode, name }) {
  const ud = buildHotmartUserData({ email, phoneCode, phone, ucode, name });
  await postHotmartCapiEvent({ eventName: 'InitiateCheckout', eventId: `checkout_${transaction}`, orderDateMs, amount, currency, ud });
}

app.post('/webhooks/hotmart', async (req, res) => {
  const body = req.body || {};
  const isTrackedSale = body.event === 'PURCHASE_APPROVED' && ((body.data || {}).product || {}).id === HOTMART_PRODUCT_ID;
  // Tolerante a espacio/salto de linea invisible al copiar la clave (14 jul 2026)
  // Hotmart a veces manda la clave en el cuerpo del mensaje y a veces en la cabecera
  // x-hotmart-hottok en vez del cuerpo -- confirmado con el diagnostico del 16 jul 2026.
  // Aceptar cualquiera de los dos lugares.
  const headerHottok = req.headers['x-hotmart-hottok'];
  const bodyOk = !!(HOTMART_HOTTOK && body.hottok && body.hottok.trim() === HOTMART_HOTTOK.trim());
  const headerOk = !!(HOTMART_HOTTOK && headerHottok && String(headerHottok).trim() === HOTMART_HOTTOK.trim());
  const hottokOk = bodyOk || headerOk;
  console.log(`Webhook Hotmart recibido: event=${body.event} product=${(body.data || {}).product && body.data.product.id} hottok=${hottokOk ? 'ok' : 'INVALIDO'} via=${bodyOk ? 'body' : (headerOk ? 'header' : 'ninguno')}`);
  if (!hottokOk) {
    // DIAGNOSTICO TEMPORAL (14 jul 2026): body.hottok no calza, buscar si Hotmart lo manda
    // en alguna cabecera en vez de en el contenido. No cambia el comportamiento (sigue
    // rechazando 401), solo deja rastro para ubicar el lugar correcto sin adivinar.
    const headerNames = Object.keys(req.headers);
    const matchingHeader = headerNames.find(h => req.headers[h] === HOTMART_HOTTOK);
    console.log(`Webhook Hotmart DIAGNOSTICO: cabeceras=[${headerNames.join(', ')}] coincide_en_cabecera=${matchingHeader || 'ninguna'}`);
    // Solo avisar a Telegram si lo rechazado era una VENTA APROBADA real (15 jul 2026) --
    // otros eventos (carrito abandonado, boleto, suscripcion, etc.) solo quedan en el log.
    if (isTrackedSale) {
      const { notifyTelegram } = require('./flows');
      notifyTelegram(`⚠️ No se pudo reportar una venta completada (clave del webhook invalida).\nRevisa la clave del webhook en Hotmart y actualizala en Render.`).catch(e => console.error('Telegram notify error:', e.message));
    }
    return res.status(401).json({ error: 'hottok invalido' });
  }
  res.status(200).json({ ok: true }); // responder rapido, Hotmart reintenta si tarda o falla

  // Guarda TODO evento que llegue (venta, cancelacion, reembolso, contracargo, boleto pendiente, etc.)
  // independiente de si es el producto/evento que dispara CAPI, para tener el historial completo.
  try {
    const data = body.data || {};
    const purchase = data.purchase || {};
    const subscription = data.subscription || {};
    const buyer = data.buyer || data.subscriber || {};
    const product = data.product || subscription.product || {};
    const price = purchase.price || {};
    const orderDateMs = purchase.order_date || body.creationDate || null;

    db.saveHotmartEvent({
      event: body.event,
      transaction_id: purchase.transaction || body.id || '',
      product_id: product.id,
      product_name: product.name,
      status: purchase.status || subscription.status || '',
      buyer_name: buyer.name,
      buyer_email: buyer.email,
      amount: price.value != null ? price.value : null,
      currency: price.currency_code,
      order_date: orderDateMs ? new Date(orderDateMs).toISOString() : '',
      capi_sent: false,
      raw: JSON.stringify(body)
    });
  } catch (e) {
    console.error('Webhook Hotmart error guardando evento:', e.message);
  }

  try {
    if (body.event !== 'PURCHASE_APPROVED' && body.event !== 'PURCHASE_BILLET_PRINTED') return;
    const data = body.data || {};
    if ((data.product || {}).id !== HOTMART_PRODUCT_ID) return;

    const transaction = (data.purchase || {}).transaction;
    if (!transaction) return;

    const buyer = data.buyer || {};
    const price = (data.purchase || {}).price || {};
    const orderDateMs = (data.purchase || {}).order_date;
    const sck = (data.purchase || {}).sckPaymentLink;
    const fbc = sck ? `fb.1.${Date.now()}.${sck}` : undefined;

    // DIAGNOSTICO TEMPORAL (16 jul 2026): confirmar con datos reales si Hotmart manda
    // mas campos de identidad (ciudad, pais, documento) que hoy no se le mandan a Meta.
    // No cambia ningun comportamiento, solo deja rastro en logs para no adivinar.
    console.log(`Hotmart buyer keys [${transaction}]: ${Object.keys(buyer).join(', ')}`);

    if (body.event === 'PURCHASE_APPROVED') {
      if (hotmartFired.has(transaction)) return;
      hotmartFired.add(transaction);
      await fireCapiHotmartPurchase({
        transaction,
        email: buyer.email,
        phoneCode: buyer.checkout_phone_code,
        phone: buyer.checkout_phone,
        amount: price.value,
        currency: price.currency_code,
        orderDateMs,
        fbc,
        ucode: buyer.ucode,
        name: buyer.name
      });
      db.markHotmartEventCapiSent(transaction);
    } else {
      // PURCHASE_BILLET_PRINTED: pidio el recibo/boleto para pagar en efectivo, aun no completa.
      if (hotmartCheckoutFired.has(transaction)) return;
      hotmartCheckoutFired.add(transaction);
      await fireCapiHotmartCheckout({
        transaction,
        email: buyer.email,
        phoneCode: buyer.checkout_phone_code,
        phone: buyer.checkout_phone,
        amount: price.value,
        currency: price.currency_code,
        orderDateMs,
        ucode: buyer.ucode,
        name: buyer.name
      });
    }
  } catch (e) {
    console.error('Webhook Hotmart error:', e.message);
  }
});

function verifyAccessToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const lastPipe = decoded.lastIndexOf('|');
    const sig = decoded.substring(lastPipe + 1);
    const data = decoded.substring(0, lastPipe);
    const parts = data.split('|');
    if (parts.length !== 4) return null;
    const [phone, pack, amount, tsStr] = parts;
    const ts = parseInt(tsStr);
    if (isNaN(ts) || Date.now() / 1000 - ts > 90 * 24 * 3600) return null;
    const secret = VERIFY_TOKEN || 'carojo_verify_2026';
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex').substring(0, 16);
    if (sig !== expectedSig) return null;
    return { phone, pack, amount: parseInt(amount) };
  } catch { return null; }
}

app.get('/acceso/:token', async (req, res) => {
  const info = verifyAccessToken(req.params.token);
  if (!info) return res.redirect(DRIVE_URLS_PIXEL.basico);
  const { phone, pack, amount } = info;
  const contact = initialized ? db.getContact(phone) : null;
  const driveUrl = contact?.folder_id
    ? `https://drive.google.com/drive/folders/${contact.folder_id}`
    : (DRIVE_URLS_PIXEL[pack] || DRIVE_URLS_PIXEL.basico);
  const packName = PACK_NAMES_PIXEL[pack] || 'Pack';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carojo Aprende y Emprende - Tu material esta listo</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff0f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border-radius:20px;padding:36px 32px;text-align:center;max-width:420px;width:100%;box-shadow:0 4px 24px rgba(233,100,168,.15)}
.logo{width:110px;height:110px;object-fit:contain;margin-bottom:8px}
h1{color:#1a1a1a;font-size:22px;font-weight:700;margin-bottom:8px}
p{color:#666;font-size:15px;line-height:1.5;margin-bottom:24px}
.btn{display:block;background:#e84c0e;color:#fff;text-decoration:none;padding:16px 24px;border-radius:12px;font-size:17px;font-weight:600;letter-spacing:.3px;transition:opacity .2s}
.btn:active{opacity:.85}
.note{color:#999;font-size:13px;margin-top:16px}
</style>
<script>setTimeout(function(){ window.location.href='${driveUrl}'; },6000);</script>
</head>
<body>
<div class="card">
  <img class="logo" src="/logo.png" alt="Carojo Aprende y Emprende">
  <h1>Tu ${packName} esta listo!</h1>
  <p>Tu pago fue confirmado y el acceso ya esta activo en tu Gmail.</p>
  <a class="btn" href="${driveUrl}">Abrir mi material ahora</a>
  <p class="note">Abrelo con el correo que nos diste. En 6 segundos te llevamos automaticamente.</p>
</div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
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
