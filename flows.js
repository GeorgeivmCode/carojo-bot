const crypto = require('crypto');
const db = require('./db');
const { sendText, sendImage } = require('./whatsapp');
const { carolRespond, verifyPayment } = require('./carol');

async function carol(history, text) {
  const raw = await carolRespond(history, text);
  const parts = raw.split('---SPLIT---').map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : raw;
}
const { grantDriveAccess } = require('./drive');
const axios = require('axios');
const {
  WELCOME_MESSAGE, DIAMANTE_DETAILS, ORO_DETAILS, ORO_UPSELL,
  BASICO_DETAILS, BASICO_UPSELL, PAYMENT_RECEIVED_ASK_EMAIL,
  PLANTILLA_ACCESO, STOPPED_MSG, OLD_CLIENT_TRIGGERS,
  INVALID_EMAIL_MSG, PAYMENT_REJECTED_MSG, PAYMENT_WRONG_AMOUNT,
  PAYMENT_WRONG_RECIPIENT, PAYMENT_NOT_SUCCESSFUL,
  SEND_COMPROBANTE_MSG, GIFT_OFFER_MSG, COMPROBANTE_FALSO_MSG,
  MOSTRARIO, TESTIMONIOS, MOSTRARIO_TRIGGERS, TESTIMONIOS_TRIGGERS,
  deliveryMessage
} = require('./content');

// Estados donde el cliente está activamente en flujo de compra
const ACTIVE_PAYMENT_STATES = new Set([
  'awaiting_comprobante', 'offered_diamante', 'offered_oro', 'offered_basico', 'awaiting_choice'
]);

// Detectar cuando dicen "ya pagué" sin enviar comprobante
const PAGO_SIN_COMPROBANTE = [
  'ya pague', 'ya pagué', 'ya transferi', 'ya transferí', 'ya mande', 'ya mandé',
  'ya deposite', 'ya deposité', 'ya hice el pago', 'ya realice', 'ya realicé',
  'acabo de pagar', 'acabe de pagar', 'ya lo pague', 'ya lo pagué',
  'ya envie', 'ya envié', 'ya hice la transferencia', 'te pague', 'te pagué',
  'ya hice el deposito', 'ya deposité', 'ya realice el pago'
];

function isPagoSinComprobante(text) {
  const t = text.toLowerCase();
  return PAGO_SIN_COMPROBANTE.some(p => t.includes(p));
}

function isAskingForGift(text) {
  const t = text.toLowerCase();
  return ['regalo', 'regalito', 'curso gratis', 'gratis', 'resina', 'globo', 'globoflexia', 'bordado', 'epoxi'].some(k => t.includes(k));
}

const GIFT_URLS = {
  resina:      'https://drive.google.com/drive/folders/1iZ6y6PtYg5APKftiR4296bT8i2rlJG0L',
  bordados:    'https://drive.google.com/drive/u/0/folders/1XpP3s7KXEnOUDizYTxlTN8jkry_uSQEY',
  globoflexia: 'https://drive.google.com/drive/folders/1YyTR18FTIR5vhmISZ6IPgTRFs5mnqW98'
};

function detectGiftChoice(text) {
  const t = text.toLowerCase();
  if (t.includes('resina') || t.includes('epoxi')) return GIFT_URLS.resina;
  if (t.includes('globo') || t.includes('decoracion') || t.includes('decoración')) return GIFT_URLS.globoflexia;
  if (t.includes('bordado') || t.includes('floral')) return GIFT_URLS.bordados;
  return null;
}

const JORGE_PHONE     = process.env.JORGE_PHONE;
const META_PIXEL_ID   = process.env.META_PIXEL_ID;
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN;
const GAS_SHEETS_URL  = process.env.GAS_SHEETS_URL;

// Monto → pack
const AMOUNT_TO_PACK = { 5000: 'basico', 10000: 'oro', 15000: 'diamante' };
const PACK_PRICES    = { basico: 5000, oro: 10000, diamante: 15000 };

function isValidGmail(email) {
  return /^[a-zA-Z0-9._%+\-]+@gmail\.com$/i.test(email.trim());
}

function isOldClientTrigger(text) {
  const t = text.toLowerCase();
  return OLD_CLIENT_TRIGGERS.some(trigger => t.includes(trigger));
}

async function sendGallery(phone, plantilla) {
  const { images, text } = plantilla;
  for (const url of images) {
    await sendImage(phone, url);
    db.saveMessage(phone, 'out', 'image', url, '');
  }
  const wamid = await sendText(phone, text);
  db.saveMessage(phone, 'out', 'text', text, wamid);
}

async function notifyJorge(contact, text) {
  if (!JORGE_PHONE) return;
  try { await sendText(JORGE_PHONE, text); } catch (e) { console.error('Jorge notify error:', e.message); }
}

async function fireCapi(contact, pack) {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return;
  try {
    const ph = crypto.createHash('sha256').update(contact.phone.replace(/\D/g, '')).digest('hex');
    const event = {
      event_name:    'Purchase',
      event_time:    Math.floor(Date.now() / 1000),
      action_source: 'other',
      event_id:      `${contact.phone}_${Date.now()}`,
      user_data:     { ph: [ph] },
      custom_data:   { currency: 'COP', value: PACK_PRICES[pack] || 0, content_name: pack, content_type: 'product' }
    };
    if (contact.ctwa_clid) event.user_data.ctwa_clid = contact.ctwa_clid;
    await axios.post(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`,
      { data: [event] },
      { params: { access_token: META_CAPI_TOKEN }, timeout: 10000 }
    );
    console.log('CAPI Purchase fired:', pack, contact.phone);
  } catch (e) { console.error('CAPI error:', e.message); }
}

async function logSaleToSheets(contact, pack, email) {
  if (!GAS_SHEETS_URL) return;
  try {
    await axios.post(GAS_SHEETS_URL, {
      fecha:     new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
      telefono:  contact.phone,
      nombre:    contact.name  || '',
      pack,
      monto:     PACK_PRICES[pack] || 0,
      email,
      ctwa_clid: contact.ctwa_clid || '',
      ad_id:     contact.ad_id     || '',
      ad_name:   contact.ad_name   || ''
    }, { timeout: 10000 });
  } catch (e) { console.error('Sheets error:', e.message); }
}

async function processMessage(phone, msgType, content, wamidIn) {
  let contact = db.getContact(phone);
  if (!contact) { db.createContact(phone); contact = db.getContact(phone); }

  db.saveMessage(phone, 'in', msgType, content, wamidIn);
  db.updateContact(phone, {
    last_message:    (msgType === 'text' ? content : `[${msgType}]`).substring(0, 200),
    last_message_at: db.now(),
    unread_count:    (contact.unread_count || 0) + 1
  });

  if (!contact.bot_active) return;
  if (contact.state === 'stopped') return;

  const text = (msgType === 'text' ? content : '').trim().toLowerCase();

  // Cliente antiguo sin acceso — solo si NO está en flujo activo de compra ni ya en recuperación
  if (msgType === 'text' && isOldClientTrigger(text) && !ACTIVE_PAYMENT_STATES.has(contact.state) && contact.state !== 'recovering_access') {
    await sendAndSave(phone, PLANTILLA_ACCESO);
    db.updateContact(phone, { state: 'recovering_access', tag: 'Soporte' });
    await notifyJorge(contact, `CLIENTE ANTIGUO sin acceso:\nTel: ${phone}\nNombre: ${contact.name || '-'}\nMensaje: "${content.substring(0, 100)}"`);
    return;
  }

  // Salir — detiene remarketing pero deja el bot activo por si vuelve
  if (['salir', 'stop', 'no gracias', 'no me interesa', 'para', 'detener'].includes(text)) {
    db.updateContact(phone, { state: 'stopped' });
    await sendAndSave(phone, STOPPED_MSG);
    return;
  }

  // Cliente que dijo Salir antes pero vuelve a escribir — reiniciar flujo
  if (contact.state === 'stopped') {
    db.updateContact(phone, { state: 'new', r1_sent: 0, r2_sent: 0 });
    contact = db.getContact(phone);
    await handleNew(contact, text);
    return;
  }

  // Imagen o PDF/documento = posible comprobante
  if (msgType === 'image' || msgType === 'document') {
    // Documento no descargable (ej. Word) — pedir imagen o PDF
    if (content === '[documento]') {
      if (ACTIVE_PAYMENT_STATES.has(contact.state) || contact.state === 'new') {
        await sendAndSave(phone, 'Para verificar tu pago necesito la imagen o PDF del comprobante. Los documentos de Word o Excel no los puedo revisar. 📸');
      }
      return;
    }
    if (ACTIVE_PAYMENT_STATES.has(contact.state) || contact.state === 'new') {
      await handleComprobante(contact, content);
      return;
    }
    if (contact.state === 'awaiting_email') {
      await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);
      return;
    }
    if (contact.state === 'recovering_access') {
      await sendAndSave(phone, 'Para activarte el acceso necesito tu correo Gmail. Escribelo asi: tunombre@gmail.com 📩');
      return;
    }
    return;
  }

  // Deteccion automatica de mostrario y testimonios
  if (msgType === 'text') {
    const tl = text.toLowerCase();
    if (MOSTRARIO_TRIGGERS.some(t => tl.includes(t))) {
      await sendGallery(phone, MOSTRARIO);
      return;
    }
    if (TESTIMONIOS_TRIGGERS.some(t => tl.includes(t))) {
      await sendGallery(phone, TESTIMONIOS);
      return;
    }
  }

  switch (contact.state) {
    case 'new':
      await handleNew(contact, text);
      break;
    case 'awaiting_choice':
      await handleChoice(contact, text);
      break;
    case 'offered_diamante':
      await handleOfferedDiamante(contact, text);
      break;
    case 'offered_oro':
      await handleOfferedOro(contact, text);
      break;
    case 'offered_basico':
      await handleOfferedBasico(contact, text);
      break;
    case 'awaiting_comprobante': {
      if (isPagoSinComprobante(text)) {
        await sendAndSave(phone, SEND_COMPROBANTE_MSG);
        break;
      }
      const history = db.getRecentMessages(phone, 8);
      await sendAndSave(phone, await carol(history, text));
      break;
    }
    case 'awaiting_email':
      await handleEmail(contact, text);
      break;
    case 'recovering_access':
      await handleRecoveryEmail(contact, text);
      break;
    case 'delivered':
      await handlePostDelivery(contact, text);
      break;
    default:
      await handleNew(contact, text);
  }
}

async function handleNew(contact, text) {
  const phone = contact.phone;
  if (['1', '2', '3'].includes(text)) {
    db.updateContact(phone, { state: 'awaiting_choice' });
    contact = db.getContact(phone);
    await handleChoice(contact, text);
  } else {
    await sendAndSave(phone, WELCOME_MESSAGE);
    db.updateContact(phone, { state: 'awaiting_choice' });
  }
}

async function handleChoice(contact, text) {
  const phone = contact.phone;
  if (text === '1') {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '2') {
    db.updateContact(phone, { state: 'offered_oro', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_UPSELL);
  } else if (text === '3') {
    db.updateContact(phone, { state: 'offered_basico', pack_selected: 'basico' });
    await sendAndSave(phone, BASICO_UPSELL);
  } else {
    const history = db.getRecentMessages(phone, 8);
    const reply = await carol(history, text);
    await sendAndSave(phone, reply);
  }
}

async function handleOfferedDiamante(contact, text) {
  const phone = contact.phone;
  if (text === '1' || text.includes('diamante') || ['si', 'sí', 'dale', 'listo', 'ok'].some(w => text.includes(w))) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else {
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
  }
}

async function handleOfferedOro(contact, text) {
  const phone = contact.phone;
  if (text === '1' || text.includes('diamante')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '2' || text.includes('oro') || ['si', 'sí', 'dale', 'listo', 'ok'].some(w => text.includes(w))) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
  } else {
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
  }
}

async function handleOfferedBasico(contact, text) {
  const phone = contact.phone;
  if (text === '1' || text.includes('diamante')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '2' || text.includes('oro')) {
    db.updateContact(phone, { state: 'offered_oro', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_UPSELL);
  } else if (text === '3' || text.includes('basico') || text.includes('básico') || ['si', 'sí', 'dale', 'listo', 'ok'].some(w => text.includes(w))) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'basico' });
    await sendAndSave(phone, BASICO_DETAILS);
  } else {
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
  }
}

async function handleComprobante(contact, mediaContent) {
  const phone = contact.phone;

  let imageBuffer, mimeType;
  try {
    const parsed = JSON.parse(mediaContent);
    imageBuffer = Buffer.from(parsed.buffer, 'base64');
    mimeType    = parsed.mimeType;
  } catch {
    await sendAndSave(phone, 'No pude abrir la imagen. Intentalo de nuevo. 📸');
    return;
  }

  await sendAndSave(phone, 'Un momento, verificando tu pago... ⏳');

  // Vision detecta el monto y determina el pack
  const result = await verifyPayment(imageBuffer, mimeType, contact.pack_selected || 'basico');

  if (!result.valido) {
    const { razon_rechazo, monto } = result;
    if (razon_rechazo === 'comprobante_falso') {
      await sendAndSave(phone, COMPROBANTE_FALSO_MSG);
    } else if (razon_rechazo === 'destinatario_invalido') {
      await sendAndSave(phone, PAYMENT_WRONG_RECIPIENT);
    } else if (razon_rechazo === 'transaccion_no_exitosa') {
      await sendAndSave(phone, PAYMENT_NOT_SUCCESSFUL);
    } else if (razon_rechazo === 'monto_invalido' || (monto && !AMOUNT_TO_PACK[monto])) {
      const pack = contact.pack_selected || 'basico';
      await sendAndSave(phone, PAYMENT_WRONG_AMOUNT(monto, PACK_PRICES[pack]));
    } else {
      await sendAndSave(phone, PAYMENT_REJECTED_MSG(null));
    }
    return;
  }

  // Detectar pack por monto (Vision puede identificar mejor que lo que el cliente eligio)
  const packByAmount = AMOUNT_TO_PACK[result.monto];
  const pack = packByAmount || contact.pack_selected || 'basico';

  db.updateContact(phone, { state: 'awaiting_email', pack_selected: pack });
  await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);

  const destino = result.destino || '';
  const paraQuien = destino.includes('3058989359') ? 'Jorge - Nequi/BRE-B' :
                    destino.includes('3217239198') ? 'Carol - Daviplata' :
                    result.nombre_destinatario || 'no identificado';

  await notifyJorge(contact,
    `PAGO verificado!\nPack: ${pack}\nMonto: $${result.monto?.toLocaleString('es-CO') || PACK_PRICES[pack]?.toLocaleString('es-CO')}\nApp: ${result.app || 'desconocida'}\nPago a: ${paraQuien}\nCliente: ${contact.name || phone}\nTel: ${phone}`
  );
}

async function handleEmail(contact, emailText) {
  const phone = contact.phone;
  const email = emailText.trim().toLowerCase();

  if (!isValidGmail(email)) {
    await sendAndSave(phone, INVALID_EMAIL_MSG);
    return;
  }

  const pack = contact.pack_selected || 'basico';

  try {
    await grantDriveAccess(email, pack);
  } catch (e) {
    console.error('Drive access error:', e.message);
    await sendAndSave(phone, 'Hubo un problema al darte acceso. Ya le avise a Jorge y lo resuelve en minutos!');
    await notifyJorge(contact, `ERROR acceso Drive:\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nError: ${e.message}`);
    return;
  }

  await sendAndSave(phone, deliveryMessage(pack));
  db.updateContact(phone, { state: 'delivered', tag: 'Facturado' });

  await fireCapi(contact, pack);
  await logSaleToSheets(contact, pack, email);
  await notifyJorge(contact,
    `ENTREGA completada!\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nNombre: ${contact.name || '-'}`
  );
}

async function handlePostDelivery(contact, text) {
  const phone = contact.phone;

  if (contact.pack_selected === 'diamante' && contact.r1_sent && !contact.gift_sent) {
    // Si ya sabe cual curso quiere → entregar link directo
    const giftLink = detectGiftChoice(text);
    if (giftLink) {
      await sendAndSave(phone,
        `Tu curso de regalo esta listo!\n\n${giftLink}\n\nToca el enlace para abrirlo. Disfruta mucho!`
      );
      db.updateContact(phone, { gift_sent: 1 });
      return;
    }
    // Si pregunta por el regalo en general → ofrecer opciones
    if (isAskingForGift(text)) {
      await sendAndSave(phone, GIFT_OFFER_MSG);
      return;
    }
  }

  const history = db.getRecentMessages(phone, 6);
  const reply = await carol(history, text);
  await sendAndSave(phone, reply);
}

async function handleRecoveryEmail(contact, emailText) {
  const phone = contact.phone;
  const email = emailText.trim().toLowerCase();

  if (!isValidGmail(email)) {
    await sendAndSave(phone, INVALID_EMAIL_MSG);
    return;
  }

  const pack = 'diamante';

  try {
    await grantDriveAccess(email, pack);
  } catch (e) {
    console.error('Drive recovery error:', e.message);
    await sendAndSave(phone, 'Hubo un problema al activarte el acceso. Jorge ya fue avisado y lo resuelve en minutos!');
    await notifyJorge(contact, `ERROR recuperacion Drive:\nEmail: ${email}\nTel: ${phone}\nError: ${e.message}`);
    return;
  }

  await sendAndSave(phone, deliveryMessage(pack));
  db.updateContact(phone, { state: 'delivered', bot_active: 0, tag: 'Facturado', pack_selected: pack });

  await notifyJorge(contact,
    `RECUPERACION completada (automatica):\nEmail: ${email}\nTel: ${phone}\nNombre: ${contact.name || '-'}`
  );
}

async function sendAndSave(phone, textOrParts) {
  const parts = Array.isArray(textOrParts) ? textOrParts : [textOrParts];
  for (let i = 0; i < parts.length; i++) {
    const wamid = await sendText(phone, parts[i]);
    db.saveMessage(phone, 'out', 'text', parts[i], wamid);
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 700));
  }
}

module.exports = { processMessage, sendAndSave };
