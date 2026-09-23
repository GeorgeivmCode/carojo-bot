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

// Cuenta las paginas de un PDF sin librerias externas.
// Un comprobante de pago real SIEMPRE es de 1 pagina; si vienen muchas, es otra cosa
// (catalogo, ebook, guia) y sirve para mostrarlo en el panel y para no tratarlo como pago.
// Devuelve 0 si no se puede determinar (PDF con estructura comprimida) — en ese caso no se asume nada.
function countPdfPages(buffer) {
  try {
    const s = buffer.toString('latin1');
    const byType = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (byType > 0) return byType;
    const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map(m => parseInt(m[1], 10));
    return counts.length ? Math.max(...counts) : 0;
  } catch {
    return 0;
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
  '120251413596020501': { name: 'F4 - Messi',              campaign: 'Messi' },
  '120251413833410501': { name: 'F5 - Messi',              campaign: 'Messi' },
  '120251413833400501': { name: 'F6 - Messi',              campaign: 'Messi' },
  // Prueba "Interaccion > compras por mensajes" (11 sep 2026): mismo creativo que F1/F4/F5 de Messi
  '120251746864710501': { name: 'F1 - TEST Compras',       campaign: 'TEST Compras' },
  '120251746866230501': { name: 'F4 - TEST Compras',       campaign: 'TEST Compras' },
  '120251746869520501': { name: 'F5 - TEST Compras',       campaign: 'TEST Compras' },
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
// Paginas publicas (portada, privacidad, condiciones).
// La portada existia solo para servir la etiqueta de verificacion de dominio de Meta y se veia en
// blanco. Se convirtio en una portada real SIN tocar esa etiqueta: si se quita, se pierde la
// verificacion de dominio en Brand Safety del Business Manager (ver memoria 29 mayo 2026).
// Privacidad y condiciones se agregaron el 8 sep 2026 porque Google las exige para publicar la
// pantalla de consentimiento y poder usar el boton de "Entrar con Google" en /acceso.
const WA_PUBLICO = '+57 324 4971371';
const CORREO_PUBLICO = 'george.camaras@gmail.com';

function paginaPublica(titulo, cuerpo, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${extraHead}
<title>${titulo} - Carojo Aprende y Emprende</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff0f6;color:#333;line-height:1.6;padding:24px}
.wrap{background:#fff;border-radius:20px;padding:32px 28px;max-width:760px;margin:0 auto;box-shadow:0 4px 24px rgba(233,100,168,.15)}
.logo{width:96px;height:96px;object-fit:contain;display:block;margin:0 auto 16px}
h1{font-size:24px;color:#1a1a1a;margin-bottom:6px;text-align:center}
h2{font-size:17px;color:#1a1a1a;margin:26px 0 8px}
p,li{font-size:15px;color:#555;margin-bottom:10px}
ul{padding-left:22px}
a{color:#e84c0e}
.fecha{text-align:center;color:#999;font-size:13px;margin-bottom:8px}
.nav{text-align:center;margin-top:28px;padding-top:18px;border-top:1px solid #f0e0e8;font-size:14px}
.nav a{margin:0 8px}
.cta{display:inline-block;background:#e84c0e;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:600;margin-top:8px}
</style>
</head>
<body><div class="wrap">
<img class="logo" src="/logo.png" alt="Carojo Aprende y Emprende">
${cuerpo}
<div class="nav">
  <a href="/">Inicio</a> ·
  <a href="/privacidad">Privacidad</a> ·
  <a href="/terminos">Condiciones</a> ·
  <a href="/data-deletion">Eliminar mis datos</a>
</div>
</div></body></html>`;
}

app.get('/', (_req, res) => {
  res.send(paginaPublica('Inicio', `
<h1>Carojo Aprende y Emprende</h1>
<p style="text-align:center">Cursos digitales de lettering, letra Timoteo y manualidades para emprender desde casa.</p>
<h2>Que ensenamos</h2>
<p>Vendemos cursos y cartillas en formato digital (PDF) para aprender lettering y letra Timoteo, marcado de cuadernos, moldes 3D, papeleria creativa y agendas personalizadas. Miles de mujeres en Colombia ya los usan para crear sus propios productos y venderlos.</p>
<h2>Como funciona</h2>
<p>La compra y la entrega se hacen por WhatsApp. Despues de confirmar tu pago te damos acceso a una carpeta personal de Google Drive con todo tu material, y el acceso queda registrado a tu cuenta de Google.</p>
<h2>Escribenos</h2>
<p>WhatsApp: <strong>${WA_PUBLICO}</strong><br>Correo: <a href="mailto:${CORREO_PUBLICO}">${CORREO_PUBLICO}</a></p>
<p style="text-align:center"><a class="cta" href="https://wa.me/573244971371">Escribirnos por WhatsApp</a></p>
`, '<meta name="facebook-domain-verification" content="clgru5a4p4a25bab2t5ose7aecavdz" />'));
});

app.get('/privacidad', (_req, res) => {
  res.send(paginaPublica('Politica de Privacidad', `
<h1>Politica de Privacidad</h1>
<div class="fecha">Actualizada el 8 de septiembre de 2026</div>
<p>Esta politica explica que datos recogemos en Carojo Aprende y Emprende, para que los usamos y como puedes pedir que los borremos. Somos un negocio colombiano que vende cursos digitales de lettering y manualidades por WhatsApp.</p>

<h2>Que datos recogemos</h2>
<ul>
  <li><strong>Tu numero de WhatsApp y el nombre</strong> que tienes puesto en WhatsApp, porque por ahi se hace toda la compra y la entrega.</li>
  <li><strong>Los mensajes de la conversacion</strong>, para poder atenderte y resolver dudas sobre tu compra.</li>
  <li><strong>La imagen del comprobante de pago</strong> que nos envias, para confirmar la transferencia.</li>
  <li><strong>Tu direccion de correo de Google</strong>, que es la llave con la que te damos acceso a tu carpeta de material.</li>
</ul>

<h2>Cuando entras con Google</h2>
<p>Si usas el boton de "Entrar con Google" para activar tu acceso, Google nos comparte unicamente <strong>tu direccion de correo y tu nombre</strong>. Nada mas.</p>
<p>No leemos tus correos, no vemos tus archivos, no accedemos a tus contactos ni a tu calendario, y no pedimos tu contrasena en ningun momento. Ese correo lo usamos solo para darte permiso de lectura sobre la carpeta de Google Drive con el material que compraste.</p>

<h2>Para que usamos tus datos</h2>
<ul>
  <li>Confirmar tu pago y entregarte el material que compraste.</li>
  <li>Darte soporte si tienes problemas para abrir o descargar tu carpeta.</li>
  <li>Avisarte de novedades o promociones por WhatsApp. Si no las quieres, escribenos la palabra <strong>Salir</strong> y dejamos de enviarte mensajes.</li>
  <li>Medir si nuestra publicidad funciona. Para esto compartimos con Meta (Facebook e Instagram) una version cifrada de tu telefono o tu correo, que no permite leer el dato original. No compartimos tus mensajes ni tus comprobantes.</li>
</ul>

<h2>Con quien los compartimos</h2>
<p>No vendemos tus datos a nadie. Solo los tratan los servicios que necesitamos para operar: Google (para darte acceso a tu carpeta de Drive), Meta (para el envio de mensajes de WhatsApp y la medicion de publicidad) y los servidores donde funciona nuestro sistema.</p>

<h2>Cuanto tiempo los guardamos</h2>
<p>Guardamos tu compra y tu acceso mientras tengas el material, porque el acceso es de por vida. Puedes pedirnos que borremos todo cuando quieras.</p>

<h2>Como pedir que borremos tus datos</h2>
<p>Escribenos por WhatsApp al <strong>${WA_PUBLICO}</strong> con el mensaje "Eliminar mis datos", o al correo <a href="mailto:${CORREO_PUBLICO}">${CORREO_PUBLICO}</a>. Lo resolvemos en maximo 30 dias. Ten en cuenta que al borrar tus datos tambien se quita tu acceso a la carpeta del material. Puedes ver el detalle en <a href="/data-deletion">esta pagina</a>.</p>

<h2>Contacto</h2>
<p>Carojo Aprende y Emprende<br>WhatsApp: <strong>${WA_PUBLICO}</strong><br>Correo: <a href="mailto:${CORREO_PUBLICO}">${CORREO_PUBLICO}</a></p>
`));
});

app.get('/terminos', (_req, res) => {
  res.send(paginaPublica('Condiciones del Servicio', `
<h1>Condiciones del Servicio</h1>
<div class="fecha">Actualizadas el 8 de septiembre de 2026</div>
<p>Estas condiciones aplican a la compra de los cursos digitales de Carojo Aprende y Emprende.</p>

<h2>Que estas comprando</h2>
<p>Cursos y cartillas en formato digital (PDF y plantillas) para aprender lettering, letra Timoteo y manualidades. Es material descargable: no se envia nada fisico a tu casa.</p>

<h2>Como se entrega</h2>
<p>Despues de confirmar tu pago te pedimos tu correo de Google y te damos acceso de lectura a una carpeta de Google Drive con tu material. El enlace te llega por WhatsApp, en la misma conversacion donde hiciste la compra. El acceso queda registrado a esa cuenta de Google y es de por vida.</p>

<h2>Uso personal</h2>
<p>El acceso es personal y no se puede transferir. Puedes usar lo que aprendes para crear y vender tus propios productos, eso es justamente para lo que existe el curso. Lo que no esta permitido es revender, regalar, publicar o compartir los archivos del curso ni el enlace de acceso. Si detectamos que un acceso se esta compartiendo, podemos retirarlo.</p>

<h2>Pagos</h2>
<p>Los precios estan en pesos colombianos y se pagan por transferencia (Nequi, Daviplata, Bre-B o corresponsal bancario) a las cuentas que te indicamos en la conversacion. Verificamos cada comprobante antes de entregar el material.</p>

<h2>Si algo sale mal</h2>
<p>Si tienes cualquier problema con tu compra o no logras abrir tu carpeta, escribenos por WhatsApp al <strong>${WA_PUBLICO}</strong> y lo resolvemos contigo.</p>

<h2>Contacto</h2>
<p>Carojo Aprende y Emprende<br>WhatsApp: <strong>${WA_PUBLICO}</strong><br>Correo: <a href="mailto:${CORREO_PUBLICO}">${CORREO_PUBLICO}</a></p>
`));
});

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
let fireCapi, logSaleToSheets, notifyJorge, generateAccessToken, notifyTelegram, handleEmail, deliverPack, reintentarAccesosPendientes, agregarAExcluidos;
let R1_MESSAGE, R2_MESSAGE, DATOS_PACK_ELEGIDO_MSG, CHECK_ACCESO_MSG;
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
    notifyTelegram = flows.notifyTelegram;
    handleEmail    = flows.handleEmail;
    deliverPack    = flows.deliverPack;
    agregarAExcluidos = flows.agregarAExcluidos;
    reintentarAccesosPendientes = flows.reintentarAccesosPendientes;
    generateAccessToken = flows.generateAccessToken;
    console.log('flows OK');

    const content = require('./content');
    R1_MESSAGE = content.R1_MESSAGE;
    R2_MESSAGE = content.R2_MESSAGE;
    DATOS_PACK_ELEGIDO_MSG = content.DATOS_PACK_ELEGIDO_MSG;
    CHECK_ACCESO_MSG = content.CHECK_ACCESO_MSG;
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

  // Solo lo que llega al numero de este bot (10 sep 2026). La app de Meta tambien esta suscrita a
  // la cuenta del numero de Anigurumis (el futuro numero de Creciendo con Fe): sin este filtro,
  // Carol de Timoteo le contestaba a esas personas desde el numero de Timoteo.
  const numeroDestino = value?.metadata?.phone_number_id;
  if (numeroDestino && process.env.WA_PHONE_ID && numeroDestino !== process.env.WA_PHONE_ID) {
    console.log(`Webhook de otro numero (${numeroDestino}), ignorado`);
    return;
  }

  // Status updates (enviado/entregado/leido/fallido)
  if (value?.statuses?.length) {
    for (const s of value.statuses) {
      const wamid = s.id;
      const status = s.status; // sent, delivered, read, failed
      // Usuarias con nombre de usuario de WhatsApp no traen numero: viene su id (BSUID)
      const phone  = s.recipient_id || s.recipient_user_id;
      console.log(`[STATUS] ${status} | phone=${phone} | wamid=${wamid}`);
      if (initialized) {
        db.updateMessageStatus(wamid, status);
        broadcast('msg_status', { phone, wamid, status });
      }
    }
  }

  if (!value?.messages?.length) return;

  const msg     = value.messages[0];
  // 14 sep 2026: WhatsApp ya deja usar nombre de usuario y ocultar el numero (como Telegram). En ese
  // caso Meta NO manda `from` sino `from_user_id` (BSUID, ej. "CO.1234..."). El bot solo leia `from`:
  // desde el 7 sep ~20-50 mensajes al dia de anuncios fallaban ("NOT NULL constraint failed:
  // messages.phone"), la persona no recibia respuesta y quedaban chats fantasma en el contador.
  // Ahora el id de WhatsApp hace de "telefono" de ese contacto y se le responde con ese id.
  // Jorge (14 sep): "hay que hacer que si los reconozca de cualquier manera, con cualquier dato". Se
  // prueba todo lo que Meta puede mandar para identificar a la persona, en este orden.
  const contacto0 = value.contacts?.[0] || {};
  const phone   = msg.from || contacto0.wa_id || msg.from_user_id || contacto0.user_id ||
                  msg.from_parent_user_id || contacto0.parent_user_id;
  const wamid   = msg.id;
  const msgType = msg.type;
  if (!phone) {
    // No deberia pasar: Meta siempre manda al menos el id de usuario. Si pasa, NO se pierde en silencio:
    // queda el mensaje completo en el log (con el anuncio de donde vino) para poder encontrarlo.
    console.error(`MENSAJE SIN NINGUN ID (no se puede responder). Payload: ${JSON.stringify({ msg, contacts: value.contacts }).slice(0, 2000)}`);
    return;
  }
  if (!msg.from) console.log(`[usuario sin numero] id=${phone} tipo=${msgType}`);

  // Referral y nombre se guardan antes de la cola (no afectan el estado del flujo)
  const referral = msg.referral;
  if (referral?.source_id || referral?.ctwa_clid) {
    console.log(`[referral] phone=${phone} source_id=${referral.source_id} ctwa_clid=${referral.ctwa_clid || 'none'}`);
    db.createContact(phone);
    const c = db.getContact(phone);
    const updates = {};
    if (referral.ctwa_clid && !c?.ctwa_clid) updates.ctwa_clid = referral.ctwa_clid;
    const nombreAnuncio = AD_MAP[referral.source_id]?.name || referral.headline || referral.source_id || '';
    if (referral.source_id && !c?.ad_id) {
      updates.ad_id        = referral.source_id;
      updates.ad_name      = nombreAnuncio;
      updates.ad_image_url = referral.image_url || '';
    }
    // El primer anuncio no se toca; el ultimo se actualiza cada vez (es el que usa Meta para atribuir)
    if (referral.source_id) {
      updates.ultimo_ad_id   = referral.source_id;
      updates.ultimo_ad_name = nombreAnuncio;
      updates.ultimo_ad_at   = db.now();
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
              const isPdf = finalMime === 'application/pdf';
              const pages = isPdf ? countPdfPages(buffer) : 0;
              if (isPdf) console.log(`Documento PDF recibido [${phone}]: ${pages || '?'} paginas, ${Math.round(buffer.length / 1024)} KB, archivo="${doc?.filename || '-'}"`);
              const payload = JSON.stringify({
                buffer: buffer.toString('base64'), mimeType: finalMime, thumb,
                ...(isPdf ? { pages, bytes: buffer.length, filename: doc?.filename || '' } : {})
              });
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
  if (filter === 'pendientes') return res.json(db.getPendientes());
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
  // Si el estado se pasa a mano a "esperando correo", arrancar el reloj de la alerta de
  // pago sin correo. Sin esto, corregir el estado desde el panel dejaba a esa clienta fuera
  // del aviso, que es justo cuando mas falta hace acordarse de ella.
  if (fields.state === 'awaiting_email') {
    const actual = db.getContact(req.params.phone);
    if (actual && actual.state !== 'awaiting_email') {
      fields.awaiting_email_at = db.now();
      fields.email_alert_1 = 0;
      fields.email_alert_2 = 0;
      fields.enlace_acceso_enviado = 0;
    }
  }
  db.updateContact(req.params.phone, fields);
  if (Object.keys(fields).length) {
    db.logAdminAction(req.params.phone, 'patch', Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(', '));
  }
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

  const { grantDriveAccess, esErrorDeEspera } = require('./drive');
  const { deliveryMessage } = require('./content');

  // 1. Dar acceso Drive
  // 14 sep 2026: si Google fallaba, este boton igual marcaba la venta y el panel decia "acceso Drive
  // enviado" (Brigith 573157131018, 12 sep: fallo por demora y nadie se entero). Ahora avisa en el
  // panel y, si fue demora, reintenta solo en segundo plano con el mismo correo.
  let regFolderId = '';
  let driveWarning = '';
  try {
    const dr = await grantDriveAccess(email, pack); regFolderId = dr.folderId || '';
  } catch (e) {
    console.error('Drive error register-sale:', e.message);
    if (e.espera || esErrorDeEspera(e)) {
      driveWarning = 'Google se demoro en dar el acceso. El bot lo sigue reintentando solo en los proximos minutos.';
      reintentarAccesoEnSegundoPlano(phone, email, pack);
    } else {
      driveWarning = `Google no dio el acceso: ${e.message}. Revisa el correo y usa Restaurar acceso.`;
      db.logAdminAction(phone, 'acceso_error', `register_sale email=${email} error=${e.message}`);
    }
  }
  // 2. Enviar mensaje de entrega con pixel URL
  try {
    const token = generateAccessToken(phone, pack);
    const accessUrl = `https://bot.carojo.uk/acceso/${token}`;
    await sendAndSave(phone, deliveryMessage(pack, accessUrl, email));
  } catch (e) { console.error('Delivery msg error:', e.message); }
  // 3. Actualizar DB
  db.updateContact(phone, { state: 'delivered', tag: 'Facturado', pack_selected: pack, delivered_at: db.now(), email, folder_id: regFolderId });
  db.logAdminAction(phone, 'register_sale', `pack=${pack}, email=${email}`);
  const updated = db.getContact(phone);
  try { await fireCapi(updated, pack); } catch (e) { console.error('CAPI error:', e.message); }
  try { await logSaleToSheets(updated, pack, email); } catch (e) { console.error('Sheets error:', e.message); }
  await agregarAExcluidos(updated);
  try { await notifyJorge(updated, `VENTA MANUAL registrada!\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nNombre: ${updated.name || '-'}`); } catch {}
  broadcast('sale', { pack, name: updated.name || 'Cliente' });
  broadcast('refresh', { phone, contact: db.getContact(phone) });
  res.json(driveWarning ? { ok: true, warning: driveWarning } : { ok: true });
});

// Reintento del acceso a Drive para ventas registradas a mano cuando Google se demoro. La venta ya
// quedo marcada: aqui solo se insiste en darle el permiso. Queda anotado en el historial del contacto.
function reintentarAccesoEnSegundoPlano(phone, email, pack) {
  const { grantDriveAccess } = require('./drive');
  const esperas = [30e3, 2 * 60e3, 5 * 60e3, 15 * 60e3];
  (async () => {
    for (let i = 0; i < esperas.length; i++) {
      await new Promise(r => setTimeout(r, esperas[i]));
      try {
        await grantDriveAccess(email, pack);
        db.logAdminAction(phone, 'acceso_activado_tras_reintento', `register_sale email=${email} intento=${i + 1}`);
        console.log(`Acceso activado tras reintento (registro manual) [${phone}] ${email}`);
        return;
      } catch (e) {
        console.error(`Reintento acceso registro manual [${phone}] intento ${i + 1}:`, e.message);
      }
    }
    db.logAdminAction(phone, 'acceso_fallo_definitivo', `register_sale email=${email}`);
  })();
}

// Enlace de acceso correcto para ESTE contacto. Existe porque pegar en el chat el enlace de otra
// clienta (workaround manual de la "trampa" de solicitar acceso) apunta al contacto equivocado:
// la pagina lee el telefono del token, asi que con el Fix de entrada con Google entregaria la
// venta a otra persona. Este boton siempre genera el token del contacto que tienes abierto.
app.get('/api/contacts/:phone/access-link', adminAuth, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  // El enlace se arma con el pack que la clienta REALMENTE pago. Si el contacto no tiene pack
  // registrado no se adivina: se avisa al panel para no mandarle la carpeta equivocada.
  const pack = c.pack_selected || '';
  if (!pack) {
    return res.status(409).json({
      error: 'sin_pack',
      mensaje: 'Este contacto no tiene pack registrado. Ponle el pack correcto primero (boton Cambiar pack o Registrar venta) y vuelve a generar el enlace.'
    });
  }
  const { carpetaDeContacto } = require('./drive');
  const token = generateAccessToken(phone, pack);
  res.json({
    url: `https://bot.carojo.uk/acceso/${token}`,
    pack,
    email: c.email || '',
    carpeta: carpetaDeContacto(c, pack) || ''
  });
});

app.post('/api/contacts/:phone/approve-payment', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { PAYMENT_RECEIVED_ASK_EMAIL } = require('./content');
  db.updateContact(phone, { state: 'awaiting_email', awaiting_email_at: db.now(), email_alert_1: 0, email_alert_2: 0, enlace_acceso_enviado: 0, enlace_fallos: 0, ayuda_correo_avisada: 0 });
  db.logAdminAction(phone, 'approve_payment', `pack=${c.pack_selected || '-'}`);
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
  db.logAdminAction(phone, 'change_email', `${oldEmail || 'sin correo'} -> ${newEmail}${revokeOk ? '' : ' (revoke del anterior FALLO)'}`);
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
  db.logAdminAction(phone, 'restore_access', `pack=${pack}, email=${email}`);
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
  db.logAdminAction(phone, 'send_gift', `gift=${gift}`);
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
  db.logAdminAction(phone, 'revoke_access', `pack=${c.pack_selected}, email=${c.email}${driveError ? ` (Drive FALLO: ${driveError})` : ''}`);
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  if (driveError) {
    res.json({ ok: true, warning: 'Estado actualizado pero Drive no respondió: ' + driveError });
  } else {
    res.json({ ok: true });
  }
});

// Deshacer una entrega hecha al correo equivocado. Caso real 10 sep 2026: la prueba del boton de
// Google se hizo con el enlace de Bibiana (573016506566) y su compra quedo entregada al correo de
// Jorge. Quita el acceso de ese correo, saca la venta del contador y deja la compra otra vez
// "esperando correo" para que la clienta entre con su propia cuenta. El pago sigue aprobado.
// Si Drive no responde no se cambia nada, para no dejar un correo con acceso y la venta borrada.
// La fila del Google Sheet NO se borra desde aqui (el script del Sheet no tiene esa accion).
app.post('/api/contacts/:phone/liberar-venta', adminAuth, async (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const phone = req.params.phone;
  const c = db.getContact(phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (!c.delivered_at || !c.email || !c.pack_selected) {
    return res.status(400).json({ error: 'Este contacto no tiene una entrega para deshacer' });
  }
  const { revokeAccess } = require('./drive');
  try {
    await revokeAccess(c.email, c.pack_selected, c.folder_id || null);
  } catch (e) {
    console.error(`liberar-venta Drive error [${phone}]:`, e.message);
    return res.status(502).json({ ok: false, error: 'Drive no respondio, no se cambio nada: ' + e.message });
  }
  db.updateContact(phone, {
    state: 'awaiting_email', tag: 'Sin etiqueta', email: '', delivered_at: '', folder_id: '',
    enlace_acceso_enviado: 0, otra_cuenta_avisada: 0, capi_omitir_proxima: 1,
    enlace_fallos: 0, ayuda_correo_avisada: 0
  });
  db.logAdminAction(phone, 'liberar_venta', `correo_quitado=${c.email}, pack=${c.pack_selected}, entregado_antes=${c.delivered_at}`);
  const updated = db.getContact(phone);
  broadcast('refresh', { phone, contact: updated });
  res.json({ ok: true, correo_quitado: c.email, pack: c.pack_selected });
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
  db.logAdminAction(phone, 'unblock_access', `state=${newState}, tag=${newTag}`);
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
  db.logAdminAction(phone, 'change_pack', `${oldPack || 'sin pack'} -> ${pack}${revokeOk ? '' : ' (revoke del anterior FALLO)'}`);

  // Si el cambio fue una SUBIDA de pack, es una venta real (el cliente pago el diferencial) y tiene
  // que quedar en el Google Sheet igual que cuando el upgrade lo procesa el bot solo. Antes este
  // boton no registraba nada, asi que los upgrades resueltos a mano no aparecian en los numeros
  // del dia — caso real Karla (573143577059, 18 ago 2026), $10.000 que no quedaron en el sheet.
  // Las bajadas de pack (correcciones) no se registran, solo las subidas.
  const PRECIOS = { basico: 5000, oro: 10000, diamante: 15000 };
  const diffPack = (PRECIOS[pack] || 0) - (PRECIOS[oldPack] || 0);
  if (oldPack && oldPack !== pack && diffPack > 0 && process.env.GAS_SHEETS_URL) {
    try {
      const axiosSheet = require('axios');
      await axiosSheet.post(process.env.GAS_SHEETS_URL, {
        action: 'upgrade', telefono: phone, pack, diferencial: diffPack
      }, { timeout: 15000 });
      console.log(`Sheet actualizado por cambio de pack manual [${phone}]: ${oldPack} -> ${pack}, +$${diffPack}`);
    } catch (e) {
      console.error('Sheet change-pack error:', e.message);
      await notifyJorge(c,
        `ALERTA: cambio de pack manual NO quedo registrado en el Sheet\nTel: ${phone}\nNombre: ${c.name || '-'}\n${oldPack} -> ${pack} (+$${diffPack})\nAgregalo a mano en la hoja.`
      ).catch(() => {});
    }
  }
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
  db.logAdminAction(phone, 'mark_fraud', `pack=${c.pack_selected || '-'}, email=${c.email || '-'}`);
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
  db.logAdminAction(phone, 'mark_test_sale', `tag=${newTag}`);
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

// Historial de acciones de administracion sobre un contacto (revocar, marcar prueba/fraude,
// cambiar pack/correo, restaurar acceso, etc.) -- antes solo quedaba el estado final.
app.get('/api/contacts/:phone/admin-actions', adminAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(db.getAdminActions(req.params.phone, limit));
});

app.get('/api/vapid-key', (_req, res) => {
  res.json({ key: vapidPublicKey });
});

// Sirve un documento (PDF) que mando un cliente, para poder abrirlo desde el panel.
// El archivo ya esta guardado dentro del mensaje en la DB (base64), no hay que pedirselo de nuevo a Meta.
app.get('/api/doc/:wamid', adminAuthMedia, (req, res) => {
  if (!initialized) return res.status(503).json({ error: 'starting' });
  const msg = db.getMessageByWamid(req.params.wamid);
  if (!msg) return res.status(404).json({ error: 'not found' });
  let parsed;
  try { parsed = JSON.parse(msg.content); } catch { return res.status(400).json({ error: 'invalid content' }); }
  if (!parsed.buffer) return res.status(400).json({ error: 'no buffer' });
  res.set('Content-Type', parsed.mimeType || 'application/pdf');
  res.set('Content-Disposition', 'inline; filename="documento.pdf"');
  res.set('Cache-Control', 'no-store');
  res.send(Buffer.from(parsed.buffer, 'base64'));
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
  if (/^\d+$/.test(String(phone || ''))) ud.ph = [sha256(phone)]; // sin numero (usuario de WhatsApp) no se inventa
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
async function fireCapiHotmartCheckout({ transaction, email, phoneCode, phone, amount, currency, orderDateMs, ucode, fbc, name }) {
  const ud = buildHotmartUserData({ email, phoneCode, phone, ucode, fbc, name });
  await postHotmartCapiEvent({ eventName: 'InitiateCheckout', eventId: `checkout_${transaction}`, orderDateMs, amount, currency, ud });
}

// El aviso automatico de Hotmart (webhook) viene RESUMIDO: no trae el codigo de
// comprador (ucode) ni el dato del clic del anuncio (tracking.source_sck). Esos dos
// campos SI existen, pero solo se ven consultando la venta puntual en la API de Hotmart
// (confirmado 17 jul 2026 comparando el webhook real contra /sales/history para la
// misma transaccion). Por eso, apenas llega una venta aprobada, se le pregunta a
// Hotmart por esa transaccion antes de avisarle a Meta, para mandar el dato completo
// desde el primer intento en vez de depender de que Meta adivine por correo/telefono.
let hotmartTokenCache = { token: null, expiresAt: 0 };
async function getHotmartToken() {
  if (hotmartTokenCache.token && Date.now() < hotmartTokenCache.expiresAt) return hotmartTokenCache.token;
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const axiosLib = require('axios');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await axiosLib.post(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
    {},
    { headers: { Authorization: `Basic ${basic}` }, timeout: 8000 }
  );
  hotmartTokenCache = { token: r.data.access_token, expiresAt: Date.now() + ((r.data.expires_in || 170000) * 1000) - 60000 };
  return hotmartTokenCache.token;
}

async function enrichHotmartSale(transaction, attempt = 1) {
  try {
    const token = await getHotmartToken();
    if (!token) return null;
    const axiosLib = require('axios');
    const r = await axiosLib.get('https://developers.hotmart.com/payments/api/v1/sales/history', {
      params: { transaction },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000
    });
    const item = (r.data.items || [])[0];
    if (!item) throw new Error('transaccion aun no indexada');
    return {
      ucode: item.buyer && item.buyer.ucode,
      sck: item.purchase && item.purchase.tracking && item.purchase.tracking.source_sck
    };
  } catch (e) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 4000));
      return enrichHotmartSale(transaction, attempt + 1);
    }
    console.error(`Hotmart enrich fallo [${transaction}] tras ${attempt} intentos:`, e.message);
    return null;
  }
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

    // El webhook casi nunca trae ucode/sck (ver nota arriba de enrichHotmartSale) --
    // se consulta la venta puntual en la API de Hotmart para completar esos dos datos.
    // Si la consulta falla (o Hotmart aun no la indexo), se sigue con lo que trajo el
    // webhook -- nunca se pierde ni se atrasa el aviso a Meta por esto.
    const enriched = await enrichHotmartSale(transaction);
    const finalUcode = (enriched && enriched.ucode) || buyer.ucode;
    const finalSck = (enriched && enriched.sck) || sck;
    const finalFbc = finalSck ? `fb.1.${Date.now()}.${finalSck}` : undefined;
    console.log(`Hotmart enrich [${transaction}]: fuente=${enriched ? 'api' : 'solo-webhook'} ucode=${finalUcode ? 'ok' : 'falta'} sck=${finalSck ? 'ok' : 'falta'} buyer_keys_webhook=${Object.keys(buyer).join(',')}`);

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
        fbc: finalFbc,
        ucode: finalUcode,
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
        fbc: finalFbc,
        ucode: finalUcode,
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
    // Sin vencimiento a proposito: el acceso se vende "de por vida". Antes caducaba a los 90 dias
    // y desde el 26 ago 2026 empezo a romperle el enlace a las compras de finales de mayo en
    // adelante (~420 clientas al 10 sep). Caso real Alexandra 573244127150, Diamante del 11 jun.
    // Sigue siendo seguro: la firma impide inventar enlaces, y Drive solo abre a quien este en
    // la lista del pack, asi que un enlace reenviado no le sirve a otra persona.
    if (isNaN(ts)) return null;
    const secret = VERIFY_TOKEN || 'carojo_verify_2026';
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex').substring(0, 16);
    if (sig !== expectedSig) return null;
    return { phone, pack, amount: parseInt(amount) };
  } catch { return null; }
}

// Google Sign-In para que la clienta entre con la cuenta que ya tiene abierta en el celular,
// sin escribir nada ni recordar contrasenas. Si no esta configurado, la pagina sigue funcionando
// igual que antes (solo no aparece el boton) — el deploy es seguro sin esta variable.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

function esNavegadorWhatsApp(ua) {
  return /WhatsApp/i.test(ua || '');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

app.get('/acceso/:token', async (req, res) => {
  const info = verifyAccessToken(req.params.token);
  // Antes un enlace invalido redirigia a la carpeta del Pack Basico: a una clienta Diamante le
  // abria una carpeta ajena donde no tenia permiso, sin ninguna explicacion. Ahora se le dice
  // que escriba por WhatsApp.
  if (!info) {
    console.log(`Enlace de acceso invalido: ${String(req.params.token).slice(0, 40)}`);
    return res.status(404).send(paginaPublica('Enlace no valido', `
<h1>Este enlace no funciona</h1>
<p style="text-align:center">Puede que se haya copiado incompleto. No te preocupes, tu compra esta segura.</p>
<p style="text-align:center">Escribenos por WhatsApp y te mandamos tu enlace de nuevo en un momento.</p>
<p style="text-align:center"><a class="cta" href="https://wa.me/573244971371">Escribir por WhatsApp</a></p>`));
  }
  const { phone, pack } = info;
  const contact = initialized ? db.getContact(phone) : null;
  // El pack manda. La carpeta la decide carpetaDeContacto (drive.js): la guardada si existe; la
  // carpeta vieja del Diamante para quien se le entrego antes del sistema de grupos (sin folder_id,
  // ~600 clientas con permiso individual ahi); y la del grupo para las demas. Desde el 8 sep todas
  // las clientas sin folder_id iban a la carpeta nueva y a las antiguas les salia "no tienes
  // acceso" (Diana 573206050781, Isabella 573178497549, Alexandra 573244127150).
  const { carpetaDeContacto } = require('./drive');
  const packEfectivo = contact?.pack_selected || pack;
  const driveUrl = carpetaDeContacto(contact, packEfectivo)
    || DRIVE_URLS_PIXEL[packEfectivo] || DRIVE_URLS_PIXEL.basico;
  const packName = PACK_NAMES_PIXEL[packEfectivo] || 'Pack';

  // Todavia no dio su correo (pago pero quedo colgada). Ahi el boton de Google es la accion principal.
  // Se exige el estado awaiting_email a proposito: es el UNICO estado al que el bot llega despues
  // de aprobar un pago. Con una condicion mas suelta (cualquiera sin correo y sin entregar) alguien
  // que todavia no ha pagado podria activarse el pack solo con entrar con Google.
  const necesitaCorreo = !!contact && contact.state === 'awaiting_email' && !contact.email;
  const enWhatsApp = esNavegadorWhatsApp(req.headers['user-agent']);
  const correoRegistrado = escapeHtml(contact?.email || '');

  const avisoWhatsApp = enWhatsApp ? `
  <div class="warn">
    <b>Abre este enlace en Chrome</b><br>
    Estas dentro del navegador de WhatsApp y Google no permite iniciar sesion aqui. Toca los tres puntitos de arriba y elige "Abrir en el navegador", o copia el enlace y pegalo en Chrome.
    <button class="copy" onclick="copiar()">Copiar el enlace</button>
    <span id="copiado" class="copiado"></span>
  </div>` : '';

  const bloqueGoogle = necesitaCorreo && GOOGLE_CLIENT_ID ? `
  <div id="gwrap">
    <div id="g_id_onload"
         data-client_id="${escapeHtml(GOOGLE_CLIENT_ID)}"
         data-callback="onGoogle"
         data-auto_prompt="false"></div>
    <div class="g_id_signin" data-type="standard" data-theme="outline" data-size="large"
         data-text="continue_with" data-shape="pill" data-logo_alignment="left" data-locale="es"></div>
  </div>
  <div id="estado" class="estado"></div>
  <script src="https://accounts.google.com/gsi/client" async defer></script>` : '';

  const cuerpoNecesitaCorreo = `
  <h1>Ya casi, falta un paso</h1>
  <p>Tu pago del ${escapeHtml(packName)} esta confirmado. Para abrirte la carpeta solo necesitamos saber con que cuenta de Google entras.</p>
  ${GOOGLE_CLIENT_ID ? `<p class="sub">Toca el boton y elige la cuenta que ya usas en este celular. No tienes que escribir nada ni recordar contrasenas.</p>` : `<p class="sub">Escribenos tu correo de Google por WhatsApp y te activamos el acceso al instante.</p>`}
  ${GOOGLE_CLIENT_ID ? `<p class="note" style="margin:0 0 8px"><b>Importante:</b> tu material queda guardado en la cuenta que elijas. Elige la tuya, no la de otra persona.</p>` : ''}
  ${bloqueGoogle}
  <div id="listo" class="hidden">
    <p class="ok">Listo! Tu acceso quedo activo 🎉</p>
    <a class="btn" id="btnListo" href="${driveUrl}">Abrir mi material</a>
  </div>`;

  const cuerpoEntregado = `
  <h1>Tu ${escapeHtml(packName)} esta listo!</h1>
  <p>Tu pago fue confirmado y el acceso ya esta activo.</p>
  <a class="btn" href="${driveUrl}">Abrir mi material</a>
  ${correoRegistrado ? `<p class="note">Importante: abrelo con la cuenta <b>${correoRegistrado}</b>. Si te sale que necesitas permiso, es porque tu celular tiene abierta otra cuenta de Google, cambiala y vuelve a tocar el boton.</p>` : `<p class="note">Abrelo con el correo que nos diste.</p>`}`;

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
p{color:#666;font-size:15px;line-height:1.5;margin-bottom:18px}
p.sub{font-size:14px;color:#888}
.btn{display:block;background:#e84c0e;color:#fff;text-decoration:none;padding:16px 24px;border-radius:12px;font-size:17px;font-weight:600;letter-spacing:.3px;transition:opacity .2s}
.btn:active{opacity:.85}
.note{color:#999;font-size:13px;margin-top:16px;margin-bottom:0}
.warn{background:#fff8e1;border:1px solid #ffe082;color:#7a5b00;border-radius:12px;padding:14px;font-size:14px;line-height:1.5;margin-bottom:20px;text-align:left}
.copy{display:block;width:100%;margin-top:10px;background:#7a5b00;color:#fff;border:0;padding:12px;border-radius:10px;font-size:15px;font-weight:600}
.copiado{display:block;font-size:13px;color:#2e7d32;margin-top:8px;min-height:16px}
#gwrap{display:flex;justify-content:center;margin:18px 0 6px}
.estado{font-size:14px;min-height:20px;color:#666}
.estado.err{color:#c62828}
.ok{color:#2e7d32;font-weight:600}
.hidden{display:none}
</style>
</head>
<body>
<div class="card">
  <img class="logo" src="/logo.png" alt="Carojo Aprende y Emprende">
  ${avisoWhatsApp}
  ${necesitaCorreo ? cuerpoNecesitaCorreo : cuerpoEntregado}
</div>
<script>
function copiar(){
  var url = window.location.href;
  var aviso = document.getElementById('copiado');
  function ok(){ if(aviso) aviso.textContent = 'Enlace copiado, pegalo en Chrome'; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(ok, fallback);
  } else { fallback(); }
  function fallback(){
    var t = document.createElement('textarea');
    t.value = url; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch(e){ if(aviso) aviso.textContent = url; }
    document.body.removeChild(t);
  }
}
function onGoogle(resp){
  var est = document.getElementById('estado');
  est.className = 'estado';
  est.textContent = 'Activando tu acceso...';
  fetch(window.location.pathname + '/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: resp.credential })
  }).then(function(r){ return r.json(); }).then(function(d){
    if (d && d.pendiente) {
      var gp = document.getElementById('gwrap'); if (gp) gp.style.display = 'none';
      est.className = 'estado';
      est.textContent = d.mensaje;
    } else if (d && d.ok) {
      var g = document.getElementById('gwrap'); if (g) g.style.display = 'none';
      est.textContent = '';
      var listo = document.getElementById('listo');
      var btn = document.getElementById('btnListo');
      if (btn && d.driveUrl) btn.href = d.driveUrl;
      if (listo) listo.className = '';
      if (d.driveUrl) setTimeout(function(){ window.location.href = d.driveUrl; }, 1200);
    } else {
      est.className = 'estado err';
      est.textContent = (d && d.mensaje) ? d.mensaje : 'No pudimos activarlo. Escribenos por WhatsApp y lo resolvemos.';
    }
  }).catch(function(){
    est.className = 'estado err';
    est.textContent = 'Fallo la conexion. Intenta de nuevo o escribenos por WhatsApp.';
  });
}
</script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Recibe la identidad de Google que la clienta acaba de confirmar en la pagina de acceso,
// la verifica contra Google y entrega el pack. Reusa deliverPack (flows.js), no duplica entrega.
app.post('/acceso/:token/google', async (req, res) => {
  const info = verifyAccessToken(req.params.token);
  if (!info) return res.status(400).json({ ok: false, mensaje: 'Este enlace ya no es valido. Escribenos por WhatsApp.' });
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ ok: false, mensaje: 'Esta opcion todavia no esta habilitada.' });
  if (!initialized) return res.status(503).json({ ok: false, mensaje: 'Intenta de nuevo en un momento.' });

  const credential = req.body?.credential;
  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({ ok: false, mensaje: 'Faltan datos. Intenta de nuevo.' });
  }

  // Verificacion del lado del servidor: nunca confiar en lo que manda el navegador.
  let email = '';
  try {
    const axiosLib = require('axios');
    const ver = await axiosLib.get('https://oauth2.googleapis.com/tokeninfo',
      { params: { id_token: credential }, timeout: 8000 });
    const d = ver.data || {};
    if (d.aud !== GOOGLE_CLIENT_ID) throw new Error('aud no coincide');
    if (String(d.email_verified) !== 'true') throw new Error('correo sin verificar');
    if (!d.email) throw new Error('sin correo en el token');
    email = String(d.email).toLowerCase();
  } catch (e) {
    console.error(`Google claim invalido [${info.phone}]:`, e.message);
    return res.status(401).json({ ok: false, mensaje: 'No pudimos confirmar tu cuenta de Google. Intenta de nuevo desde Chrome.' });
  }

  const phone = info.phone;
  const contact = db.getContact(phone);
  if (!contact) return res.status(404).json({ ok: false, mensaje: 'No encontramos tu compra. Escribenos por WhatsApp.' });

  const { carpetaDeContacto } = require('./drive');
  const driveUrlDe = c => {
    const p = c?.pack_selected || info.pack;
    return carpetaDeContacto(c, p) || DRIVE_URLS_PIXEL[p] || DRIVE_URLS_PIXEL.basico;
  };

  // Ya entregada y entra con la MISMA cuenta: solo mandarla al material.
  if (contact.delivered_at && contact.email && contact.email.toLowerCase() === email) {
    return res.json({ ok: true, driveUrl: driveUrlDe(contact) });
  }

  // Ya entregada pero entra con OTRA cuenta de Google. No se le da acceso automatico a proposito:
  // seria una puerta para revender el material (el problema que se cerro con las carpetas privadas).
  // Se le explica cual cuenta usar y se le avisa a Jorge para que el decida con el boton Cambiar Gmail.
  if (contact.delivered_at) {
    console.log(`Google claim con otra cuenta [${phone}]: registrada=${contact.email || '-'} intento=${email}`);
    try {
      db.logAdminAction(phone, 'google_claim_otra_cuenta', `registrada=${contact.email || '-'} intento=${email}`);
      if (!contact.otra_cuenta_avisada) {
        await notifyTelegram(
          `ENTRA CON OTRA CUENTA DE GOOGLE\nNombre: ${contact.name || '-'}\nTel: ${phone}\nCorreo registrado: ${contact.email || '-'}\nCuenta con la que entro: ${email}\nSi es la misma persona y quieres pasarle el acceso a esa cuenta, usa el boton "Cambiar Gmail" en el panel.`
        );
        db.updateContact(phone, { otra_cuenta_avisada: 1 });
      }
    } catch (e) { console.error('Aviso otra cuenta error:', e.message); }
    return res.json({
      ok: false,
      mensaje: `Tu acceso quedo registrado a ${contact.email}. Estas entrando con ${email}. Cambia de cuenta en tu celular y vuelve a intentar, o escribenos por WhatsApp y te lo pasamos a esta cuenta.`
    });
  }

  // Misma guarda que la pagina: solo se entrega si el contacto esta en awaiting_email, el unico
  // estado al que llega el bot DESPUES de aprobar un pago. Nunca confiar solo en el chequeo del
  // navegador, esta validacion es la que de verdad protege.
  if (contact.state !== 'awaiting_email') {
    console.log(`Google claim rechazado [${phone}]: estado=${contact.state} (no hay pago aprobado)`);
    return res.status(409).json({
      ok: false,
      mensaje: 'Todavia no tenemos un pago confirmado en esta conversacion. Escribenos por WhatsApp y lo revisamos.'
    });
  }

  // El caso que motivo todo esto: pago y nunca dio su correo.
  // deliverPack captura el correo, marca la venta, la deja en el Google Sheet, dispara el pixel
  // y te avisa por Telegram y WhatsApp. Es la misma entrega de siempre, no una version aparte.
  try {
    const r = await deliverPack(contact, email);
    // Google tardo (o ya se esta activando por otro intento): el bot reintenta solo y le manda el
    // enlace por WhatsApp. No es un error para la clienta, no hace falta que vuelva a tocar el boton.
    if (r && (r.pendiente || r.enCurso)) {
      return res.json({ ok: false, pendiente: true, mensaje: 'Estamos activando tu acceso, Google se esta demorando un poquito. En un minuto te llega el enlace por WhatsApp, no tienes que tocar nada mas.' });
    }
    if (!r || !r.ok) {
      return res.status(500).json({ ok: false, mensaje: 'Tuvimos un problema al activarlo. Ya avisamos a nuestro equipo, te escribimos por WhatsApp en minutos.' });
    }
    db.logAdminAction(phone, 'entrega_por_google', `email=${email} pack=${r.pack}`);
    console.log(`Entrega por Google OK [${phone}]: ${email} pack=${r.pack}`);
    broadcast('refresh', { phone, contact: db.getContact(phone) });
    return res.json({ ok: true, driveUrl: driveUrlDe(db.getContact(phone)) });
  } catch (e) {
    console.error(`Entrega por Google error [${phone}]:`, e.message);
    return res.status(500).json({ ok: false, mensaje: 'Tuvimos un problema al activarlo. Escribenos por WhatsApp y lo resolvemos.' });
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
let ultimoDespertarGrupos = 0;

function startScheduler() {
  // Accesos a Drive que Google tardo en dar: se reintentan cada 30 s, a cualquier hora (una clienta
  // que ya pago no tiene que esperar a la mañana). Y cada 5 min se despierta el script de grupos de
  // Google para que no se duerma y la proxima entrega no tarde.
  let reintentandoAccesos = false;
  setInterval(async () => {
    if (!initialized || reintentandoAccesos) return;
    reintentandoAccesos = true;
    try {
      await reintentarAccesosPendientes();
      if (Date.now() - ultimoDespertarGrupos > 5 * 60 * 1000) {
        ultimoDespertarGrupos = Date.now();
        require('./drive').despertarGrupos();
      }
    } catch (e) {
      console.error('Reintento accesos error:', e.message);
    } finally {
      reintentandoAccesos = false;
    }
  }, 30 * 1000);

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

    // Datos de pago del pack elegido para quien no contesto la oferta de subir de pack en 10 min.
    // Pasa a awaiting_comprobante para que no se le mande dos veces (ver getStuckInUpsell).
    for (const c of db.getStuckInUpsell()) {
      try {
        const msgDatos = DATOS_PACK_ELEGIDO_MSG(c.pack_selected);
        await sendText(c.phone, msgDatos);
        db.saveMessage(c.phone, 'out', 'text', msgDatos, '');
        db.updateContact(c.phone, { state: 'awaiting_comprobante' });
        console.log(`Datos del pack elegido enviados [${c.phone}] pack=${c.pack_selected} (no contesto la oferta)`);
        broadcast('refresh', { phone: c.phone, contact: db.getContact(c.phone) });
      } catch (e) { console.error('Datos pack elegido error', c.phone, e.message); }
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

    // "Pudiste abrir tu material?" a los 30 min de la entrega. Reemplaza la oferta de subir de pack
    // de los 2 minutos (1 de 113 subio). La oferta ahora sale cuando responde que si pudo abrir.
    for (const c of db.getForCheckAcceso()) {
      try {
        await sendText(c.phone, CHECK_ACCESO_MSG);
        db.saveMessage(c.phone, 'out', 'text', CHECK_ACCESO_MSG, '');
        db.updateContact(c.phone, { check_acceso_sent: 1 });
        console.log(`Pregunta de acceso enviada [${c.phone}] pack=${c.pack_selected}`);
        broadcast('refresh', { phone: c.phone, contact: db.getContact(c.phone) });
      } catch (e) {
        // Si falla (ej. fuera de la ventana de 24h) no se reintenta en cada vuelta
        db.updateContact(c.phone, { check_acceso_sent: 1 });
        console.error('Pregunta de acceso error', c.phone, e.message);
      }
    }

    // La alerta "PAGO SIN CORREO" por Telegram (1 h y 12 h) se quito el 10 sep 2026 a pedido de
    // Jorge: el celular debe sonar por ventas, no por soporte. Esos casos se revisan en el filtro
    // "Pendientes" del panel.
  }, 2 * 60 * 1000);
}
