const crypto = require('crypto');
const db = require('./db');
const { sendText, sendImage } = require('./whatsapp');
const { carolRespond, verifyPayment } = require('./carol');

const PACK_AMOUNTS = { basico: 5000, oro: 10000, diamante: 15000 };
const BOT_URL = 'https://carojo-bot.onrender.com';

function generateAccessToken(phone, pack) {
  const ts = Math.floor(Date.now() / 1000);
  const amount = PACK_AMOUNTS[pack] || 5000;
  const data = `${phone}|${pack}|${amount}|${ts}`;
  const secret = process.env.VERIFY_TOKEN || 'carojo_verify_2026';
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex').substring(0, 16);
  return Buffer.from(`${data}|${sig}`).toString('base64url');
}

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
  PAYMENT_OLD_DATE_MSG, MOSTRARIO, TESTIMONIOS,
  MOSTRARIO_TRIGGERS, TESTIMONIOS_TRIGGERS, deliveryMessage
} = require('./content');

// Estados donde el cliente ya comprometió un pack o está enviando comprobante
// NOTA: awaiting_choice NO está aquí — en ese estado aún se debe detectar clientes antiguos
const ACTIVE_PAYMENT_STATES = new Set([
  'awaiting_comprobante', 'offered_diamante', 'offered_oro', 'offered_basico'
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

  // Si hay palabras de pregunta el cliente esta consultando, no eligiendo
  const esPreg = ['como', 'cómo', 'que es', 'qué es', 'de que', 'de qué', 'cuéntame', 'cuentame',
    'me cuentas', 'informacion', 'información', 'explica', 'trata', 'tiene', '?'].some(p => t.includes(p));
  if (esPreg) return null;

  const eResina  = t.includes('resina') || t.includes('epoxi');
  const eGlobo   = t.includes('globo') || t.includes('decoracion') || t.includes('decoración');
  const eBordado = t.includes('bordado') || t.includes('floral');

  // Si menciona mas de uno esta preguntando por ambos, no eligiendo
  if ([eResina, eGlobo, eBordado].filter(Boolean).length > 1) return null;

  if (eResina)  return GIFT_URLS.resina;
  if (eGlobo)   return GIFT_URLS.globoflexia;
  if (eBordado) return GIFT_URLS.bordados;
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
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) {
    console.warn('CAPI skip: falta META_PIXEL_ID o META_CAPI_TOKEN');
    return;
  }
  try {
    const sha256 = v => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

    const rawPhone = contact.phone.replace(/\D/g, '');
    const ud = { ph: [sha256(rawPhone)] };

    // Email mejora EMQ de ~4 a 8+ — es la señal mas fuerte despues de ctwa_clid
    if (contact.email) ud.em = [sha256(contact.email)];

    // Nombre (primer token) si existe
    if (contact.name) {
      const fn = contact.name.split(' ')[0];
      if (fn) ud.fn = [sha256(fn)];
    }

    // ctwa_clid: señal de atribucion directa a campañas CTWA — sin esto no aparece en Ads Manager
    if (contact.ctwa_clid) {
      ud.ctwa_clid = contact.ctwa_clid;
      // fbc derivado del ctwa_clid — mejora atribucion en Ads Manager (mismo mecanismo que pixel browser)
      const clickTs = contact.created_at
        ? Math.floor(new Date(contact.created_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      ud.fbc = `fb.1.${clickTs}.${contact.ctwa_clid}`;
    }

    const event = {
      event_name:        'Purchase',
      event_time:        Math.floor(Date.now() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      event_id:          `purchase_${contact.phone}_${Date.now()}`,
      user_data:         ud,
      custom_data: {
        currency:     'COP',
        value:        PACK_PRICES[pack] || 0,
        content_name: pack,
        content_type: 'product',
        content_ids:  [pack],
        contents:     [{ id: pack, quantity: 1 }]
      }
    };

    const signals = [
      'ph=si',
      contact.email     ? 'em=si' : 'em=NO',
      contact.name      ? 'fn=si' : 'fn=NO',
      contact.ctwa_clid ? 'ctwa_clid=si' : 'ctwa_clid=NO'
    ].join(' | ');
    console.log(`CAPI enviando: pack=${pack} phone=${contact.phone} pixel=${META_PIXEL_ID} | ${signals}`);

    const capiRes = await axios.post(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`,
      { data: [event] },
      { params: { access_token: META_CAPI_TOKEN }, timeout: 10000 }
    );
    console.log('CAPI ok:', JSON.stringify(capiRes.data));
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error('CAPI error:', detail);
  }
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

async function processMessage(phone, msgType, content, wamidIn, opts = {}) {
  const { skipSave = false } = opts;
  let contact = db.getContact(phone);
  if (!contact) { db.createContact(phone); contact = db.getContact(phone); }

  if (!skipSave) {
    db.saveMessage(phone, 'in', msgType, content, wamidIn);
    db.updateContact(phone, {
      last_message:    (msgType === 'text' ? content : `[${msgType}]`).substring(0, 200),
      last_message_at: db.now(),
      unread_count:    (contact.unread_count || 0) + 1
    });
  } else {
    contact = db.getContact(phone);
  }

  if (!contact.bot_active) return;
  if (contact.state === 'stopped') return;

  const text = (msgType === 'text' ? content : '').trim().toLowerCase();

  // Cliente antiguo sin acceso — en cualquier estado que NO sea compra comprometida
  // awaiting_email se excluye: ya pagó, solo está dando su correo; "no me llega" aquí es por Gmail lleno
  if (msgType === 'text' && isOldClientTrigger(text) && !ACTIVE_PAYMENT_STATES.has(contact.state) && contact.state !== 'old_client' && contact.state !== 'delivered' && contact.state !== 'awaiting_email') {
    await sendAndSave(phone, PLANTILLA_ACCESO);
    db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
    await notifyJorge(contact, `CLIENTE ANTIGUO sin acceso:\nTel: ${phone}\nNombre: ${contact.name || '-'}\nMensaje: "${content.substring(0, 100)}"`);
    return;
  }

  // Cliente en estado old_client que vuelve a escribir — no responder automaticamente
  if (contact.state === 'old_client') return;

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
    if (ACTIVE_PAYMENT_STATES.has(contact.state) || contact.state === 'new' || contact.state === 'awaiting_choice') {
      // Si está en 'new', revisar mensajes recientes por si es cliente antiguo
      if (contact.state === 'new') {
        const recentMsgs = db.getRecentMessages(phone, 4);
        const hadOldTrigger = recentMsgs
          .filter(m => m.direction === 'in' && m.type === 'text')
          .some(m => OLD_CLIENT_TRIGGERS.some(t => m.content.toLowerCase().includes(t)));
        if (hadOldTrigger) {
          await sendAndSave(phone, PLANTILLA_ACCESO);
          db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
          await notifyJorge(contact, `CLIENTE ANTIGUO (envio imagen):\nTel: ${phone}\nNombre: ${contact.name || '-'}`);
          return;
        }
      }
      await handleComprobante(contact, content);
      return;
    }
    if (contact.state === 'awaiting_email') {
      await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);
      return;
    }
    // Estado inesperado para imagen — log para diagnostico y guiar al cliente
    console.log(`[IMG-ESTADO-INESPERADO] phone=${phone} state=${contact.state}`);
    await sendAndSave(phone, 'Para procesar tu pago primero necesito que elijas tu pack. Escribe 1, 2 o 3 segun tu eleccion. 😊');
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
    case 'old_client':
      // bot_active=0 ya lo bloqueó arriba; esto es fallback por si se reactiva manualmente
      return;
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
      // Cambio de pack en medio del flujo — directo al pago, sin upsell
      const wantsDiamante = text.includes('diamante') || text.includes('mega');
      const wantsOro = !wantsDiamante && (text.includes('oro') || text.includes('super') || text.includes('superpack'));
      const wantsBasico = !wantsDiamante && !wantsOro && (text.includes('basico') || text.includes('básico'));
      if (wantsDiamante) {
        if (contact.pack_selected !== 'diamante') {
          db.updateContact(phone, { pack_selected: 'diamante' });
          await sendAndSave(phone, DIAMANTE_DETAILS);
        } else {
          await sendAndSave(phone, 'Perfecto! Ya tienes seleccionado el MEGA PACK DIAMANTE 💎 Solo me falta tu comprobante de $15.000 para activarte el acceso. 📲');
        }
        break;
      }
      if (wantsOro) {
        if (contact.pack_selected !== 'oro') {
          db.updateContact(phone, { pack_selected: 'oro' });
          await sendAndSave(phone, ORO_DETAILS);
        } else {
          await sendAndSave(phone, 'Perfecto! Ya tienes seleccionado el SUPERPACK ORO ✨ Solo me falta tu comprobante de $10.000 para activarte el acceso. 📲');
        }
        break;
      }
      if (wantsBasico) {
        if (contact.pack_selected !== 'basico') {
          db.updateContact(phone, { pack_selected: 'basico' });
          await sendAndSave(phone, BASICO_DETAILS);
        } else {
          await sendAndSave(phone, 'Perfecto! Ya tienes seleccionado el PACK BASICO 📖 Solo me falta tu comprobante de $5.000 para activarte el acceso. 📲');
        }
        break;
      }
      const history = db.getRecentMessages(phone, 8);
      await sendAndSave(phone, await carol(history, text));
      break;
    }
    case 'awaiting_email':
      await handleEmail(contact, text);
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
  // Accept "1"/"1."/"1 algo", "2"/"2 algo", "3"/"3 algo" and pack keywords
  const isDiamante = text === '1' || /^1\b/.test(text) || text.includes('diamante');
  const isOro      = !isDiamante && (text === '2' || /^2\b/.test(text) || text === 'oro');
  const isBasico   = !isDiamante && !isOro && (text === '3' || /^3\b/.test(text) || text === 'basico' || text === 'básico');

  if (isDiamante) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    // Skip resending details only if DIAMANTE_DETAILS part 3 ya fue enviada
    // "Quedo atenta a tu comprobante" solo existe en DIAMANTE_DETAILS, nunca en WELCOME_MESSAGE
    const recent = db.getRecentMessages(phone, 12);
    const alreadySent = recent.some(m => m.direction === 'out' && m.content.includes('Quedo atenta a tu comprobante'));
    if (alreadySent) {
      await sendAndSave(phone, 'Perfecto! Te espero con el comprobante de $15.000 al numero que ya te di. 💎📲');
    } else {
      await sendAndSave(phone, DIAMANTE_DETAILS);
    }
  } else if (isOro) {
    db.updateContact(phone, { state: 'offered_oro', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_UPSELL);
  } else if (isBasico) {
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
  // "si/dale/ok" = acepta el upsell a Diamante que se estaba ofreciendo
  if (text === '1' || text.includes('diamante') || ['si', 'sí', 'dale', 'listo', 'ok', 'claro'].some(w => text.includes(w))) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '2' || text.includes('oro') || ['no'].some(w => text.includes(w))) {
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
  } else if (text === '2' || text.includes('oro') || ['si', 'sí', 'dale', 'listo', 'ok', 'claro'].some(w => text.includes(w))) {
    // Cliente acepto subir de Basico a Oro — ir directo al pago, sin upsell a Diamante
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
  } else if (text === '3' || text.includes('basico') || text.includes('básico') || text.includes('no')) {
    // "no" = declina upsell, se queda con Basico
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
  let result;
  try {
    result = await verifyPayment(imageBuffer, mimeType, contact.pack_selected || 'basico');
  } catch (e) {
    console.error(`verifyPayment error [${phone}]:`, e.message);
    await sendAndSave(phone, 'Tuve un problema procesando tu imagen. Por favor enviamela de nuevo. 📸');
    return;
  }

  if (!result.valido) {
    const { razon_rechazo, monto } = result;
    if (razon_rechazo === 'no_es_comprobante') {
      if (contact.state === 'new') {
        await sendAndSave(phone, PLANTILLA_ACCESO);
        db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
        await notifyJorge(contact,
          `POSIBLE CLIENTE ANTIGUO (envio imagen que no es comprobante):\nTel: ${phone}\nNombre: ${contact.name || '-'}`
        );
      } else {
        // En flujo activo de pago = cliente confundido, pedir el comprobante correcto
        await sendAndSave(phone,
          'Esa imagen no parece ser un comprobante de transferencia bancaria. Necesito la captura de tu pago por Nequi, Daviplata u otra app. Si ya compraste antes y tienes problemas de acceso, escribeme "ya compre" y lo resolvemos!'
        );
      }
      return;
    } else if (razon_rechazo === 'comprobante_falso') {
      await sendAndSave(phone, COMPROBANTE_FALSO_MSG);
    } else if (razon_rechazo === 'fecha_incorrecta') {
      await sendAndSave(phone, PLANTILLA_ACCESO);
      db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
      await notifyJorge(contact,
        `CLIENTE ANTIGUO (comprobante con fecha pasada):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nFecha comprobante: ${result.fecha || 'no detectada'}`
      );
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

  // Normalizar monto — Vision puede retornar "15.000" (string con punto) en vez de 15000
  const rawMonto = result.monto;
  const normalizedMonto = rawMonto != null
    ? parseInt(String(rawMonto).replace(/\./g, '').replace(/,/g, ''), 10) || null
    : null;
  const packByAmount = normalizedMonto ? AMOUNT_TO_PACK[normalizedMonto] : undefined;
  const pack = packByAmount || contact.pack_selected || null;

  // Si no se puede determinar el pack, pedir confirmacion en lugar de entregar basico por defecto
  if (!pack) {
    db.updateContact(phone, { state: 'awaiting_choice' });
    await sendAndSave(phone, 'Pago verificado! Para activarte el acceso confirmame: escribe 1 para Diamante ($15.000), 2 para Oro ($10.000) o 3 para Basico ($5.000). 💎');
    await notifyJorge(contact, `ATENCION: Pago verificado pero monto no detectado (${result.monto}). Necesita confirmacion de pack.\nTel: ${phone}`);
    return;
  }

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
  const rawText = emailText.trim().toLowerCase();

  // Extraer gmail de texto combinado (ej. "mira el pago\njuanita@gmail.com")
  const gmailMatch = rawText.match(/[\w._%+\-]+@gmail\.com/i);
  const email = gmailMatch ? gmailMatch[0].toLowerCase() : rawText;

  if (!gmailMatch) {
    // Sin gmail detectado — verificar si dice que no tiene o lo tiene lleno
    const sinGmail = ['no tengo gmail', 'no tengo correo', 'no tengo email', 'no hay espacio',
      'sin espacio', 'esta lleno', 'está lleno', 'llena de correo', 'no cabe', 'lleno de correo',
      'no tengo cuenta', 'no me llega correo'];
    if (sinGmail.some(p => rawText.includes(p))) {
      await sendAndSave(phone,
        'No te preocupes! El acceso no ocupa espacio en tu Gmail — el material vive en nuestro Google Drive, no en tu bandeja de entrada. Solo necesitamos el correo para registrar tu acceso.\n\nEscribenos tu Gmail completo:\ntunombre@gmail.com 📩'
      );
      return;
    }

    if (!email.includes('@')) {
      await sendAndSave(phone, 'Para activar tu acceso solo necesito tu Gmail 📩\n\nEscribelo asi:\ntunombre@gmail.com');
      return;
    }

    if (!isValidGmail(email)) {
      await sendAndSave(phone, INVALID_EMAIL_MSG);
      return;
    }
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

  const accessToken = generateAccessToken(phone, pack);
  const accessUrl = `${BOT_URL}/acceso/${accessToken}`;
  await sendAndSave(phone, deliveryMessage(pack, accessUrl));
  db.updateContact(phone, { state: 'delivered', tag: 'Facturado', delivered_at: db.now(), email });

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

async function sendAndSave(phone, textOrParts) {
  const parts = Array.isArray(textOrParts) ? textOrParts : [textOrParts];
  for (let i = 0; i < parts.length; i++) {
    const wamid = await sendText(phone, parts[i]);
    db.saveMessage(phone, 'out', 'text', parts[i], wamid);
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 700));
  }
}

module.exports = { processMessage, sendAndSave, fireCapi, logSaleToSheets, notifyJorge, generateAccessToken };
