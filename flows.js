const db = require('./db');
const { sendText } = require('./whatsapp');
const { carolRespond, verifyPayment } = require('./carol');
const { grantDriveAccess, getFolderUrl } = require('./drive');
const axios = require('axios');
const {
  WELCOME_MESSAGE, DIAMANTE_DETAILS, ORO_DETAILS, ORO_UPSELL,
  BASICO_DETAILS, BASICO_UPSELL, PAYMENT_CONFIRMED_ASK_EMAIL,
  deliveryMessage, INVALID_EMAIL_MSG, PAYMENT_REJECTED_MSG, PAYMENT_WRONG_AMOUNT
} = require('./content');

const JORGE_PHONE = process.env.JORGE_PHONE;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

const PACK_PRICES = { basico: 5000, oro: 10000, diamante: 15000 };

function isValidGmail(email) {
  return /^[a-zA-Z0-9._%+\-]+@gmail\.com$/i.test(email.trim());
}

async function notifyJorge(contact, text) {
  if (!JORGE_PHONE) return;
  try {
    await sendText(JORGE_PHONE, text);
  } catch (e) {
    console.error('Error notificando a Jorge:', e.message);
  }
}

async function fireCapi(contact, pack) {
  if (!MAKE_WEBHOOK_URL) return;
  try {
    await axios.post(MAKE_WEBHOOK_URL, {
      phone: contact.phone,
      name: contact.name,
      pack,
      amount: PACK_PRICES[pack] || 0,
      ctwa_clid: contact.ctwa_clid || '',
      ad_id: contact.ad_id || '',
      ad_name: contact.ad_name || '',
      event: 'Purchase'
    }, { timeout: 10000 });
  } catch (e) {
    console.error('Error CAPI Make:', e.message);
  }
}

async function processMessage(phone, msgType, content, wamidIn) {
  let contact = db.getContact(phone);
  if (!contact) {
    db.createContact(phone);
    contact = db.getContact(phone);
  }

  // Save inbound message
  db.saveMessage(phone, 'in', msgType, content, wamidIn);
  db.updateContact(phone, {
    last_message: content.substring(0, 200),
    last_message_at: db.now(),
    unread_count: (contact.unread_count || 0) + 1
  });

  // Bot is disabled — human takeover
  if (!contact.bot_active) return;

  // Stopped contact — ignore
  if (contact.state === 'stopped') return;

  const text = (msgType === 'text' ? content : '').trim().toLowerCase();

  // Handle image (comprobante)
  if (msgType === 'image' && contact.state === 'awaiting_comprobante') {
    await handleComprobante(contact, content, wamidIn);
    return;
  }

  // "Salir" or "stop" keywords
  if (['salir', 'stop', 'no gracias', 'no me interesa'].includes(text)) {
    db.updateContact(phone, { state: 'stopped', bot_active: 0 });
    const reply = 'Listo, no te escribo mas. Si en algun momento quieres los packs, aqui estamos!';
    await sendAndSave(phone, reply);
    return;
  }

  // State machine
  switch (contact.state) {
    case 'new':
    case 'r1_sent':
    case 'r2_sent':
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

    case 'awaiting_comprobante':
      if (msgType !== 'image') {
        const reply = 'Enviame la foto del comprobante de pago para verificarlo!';
        await sendAndSave(phone, reply);
      }
      break;

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
  if (text === '1') {
    db.updateContact(phone, { state: 'offered_diamante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
    db.updateContact(phone, { state: 'awaiting_comprobante' });
  } else if (text === '2') {
    db.updateContact(phone, { state: 'offered_oro', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_UPSELL);
  } else if (text === '3') {
    db.updateContact(phone, { state: 'offered_basico', pack_selected: 'basico' });
    await sendAndSave(phone, BASICO_UPSELL);
  } else {
    // Carol responds to free-form text
    const history = db.getRecentMessages(phone, 8);
    const reply = await carolRespond(history, text);
    await sendAndSave(phone, reply);
  }
}

async function handleOfferedDiamante(contact, text) {
  const phone = contact.phone;
  if (['si', 'sí', 'quiero', 'ok', 'dale', 'listo', 'perfecto'].some(w => text.includes(w))) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '1' || text.includes('diamante')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else {
    const history = db.getRecentMessages(phone, 8);
    const reply = await carolRespond(history, text);
    await sendAndSave(phone, reply);
  }
}

async function handleOfferedOro(contact, text) {
  const phone = contact.phone;
  if (text === '1' || text.includes('diamante')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '2' || text.includes('oro') || ['si', 'sí', 'quiero', 'ok', 'dale', 'listo'].some(w => text.includes(w))) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
    db.updateContact(phone, { state: 'awaiting_comprobante' });
  } else {
    const history = db.getRecentMessages(phone, 8);
    const reply = await carolRespond(history, text);
    await sendAndSave(phone, reply);
  }
}

async function handleOfferedBasico(contact, text) {
  const phone = contact.phone;
  if (text === '2' || text.includes('oro')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_UPSELL);
    db.updateContact(phone, { state: 'awaiting_comprobante' });
  } else if (text === '1' || text.includes('diamante')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '3' || text.includes('basico') || text.includes('básico') || ['si', 'sí', 'quiero', 'ok', 'dale', 'listo'].some(w => text.includes(w))) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'basico' });
    await sendAndSave(phone, BASICO_DETAILS);
    db.updateContact(phone, { state: 'awaiting_comprobante' });
  } else {
    const history = db.getRecentMessages(phone, 8);
    const reply = await carolRespond(history, text);
    await sendAndSave(phone, reply);
  }
}

async function handleComprobante(contact, mediaContent, wamid) {
  const phone = contact.phone;
  const pack = contact.pack_selected || 'basico';

  // mediaContent here is a JSON string with { buffer, mimeType } encoded as base64
  let imageBuffer, mimeType;
  try {
    const parsed = JSON.parse(mediaContent);
    imageBuffer = Buffer.from(parsed.buffer, 'base64');
    mimeType = parsed.mimeType;
  } catch {
    await sendAndSave(phone, 'No pude abrir la imagen. Intentalo de nuevo.');
    return;
  }

  const verifying = 'Un momento, verificando tu pago...';
  await sendAndSave(phone, verifying);

  const result = await verifyPayment(imageBuffer, mimeType, pack);

  if (!result.valido) {
    const expectedAmount = PACK_PRICES[pack];
    if (result.monto && result.monto !== expectedAmount) {
      await sendAndSave(phone, PAYMENT_WRONG_AMOUNT(result.monto, expectedAmount));
    } else {
      await sendAndSave(phone, PAYMENT_REJECTED_MSG(result.razon_rechazo));
    }
    return;
  }

  // Payment valid
  db.updateContact(phone, { state: 'awaiting_email', pack_selected: pack });
  await sendAndSave(phone, PAYMENT_CONFIRMED_ASK_EMAIL);

  // Notify Jorge
  const packLabel = pack.charAt(0).toUpperCase() + pack.slice(1);
  await notifyJorge(contact,
    `VENTA confirmada!\nPack: ${packLabel}\nMonto: $${PACK_PRICES[pack].toLocaleString('es-CO')}\nContacto: ${contact.name || phone}\nTel: ${phone}`
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
    console.error('Error granting drive access:', e.message);
    await sendAndSave(phone, 'Hubo un problema al darte acceso. Ya le avise a Jorge y lo resuelve en minutos!');
    await notifyJorge(contact, `ERROR dando acceso Drive:\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nError: ${e.message}`);
    return;
  }

  const driveUrl = getFolderUrl(pack);
  const delivMsg = deliveryMessage(pack, driveUrl);
  await sendAndSave(phone, delivMsg);

  db.updateContact(phone, { state: 'delivered', tag: 'Cliente' });

  // Fire CAPI
  await fireCapi(contact, pack);

  // Final Jorge notification
  const packLabel = pack.charAt(0).toUpperCase() + pack.slice(1);
  await notifyJorge(contact,
    `Entrega completada!\nPack: ${packLabel}\nEmail: ${email}\nTel: ${phone}`
  );
}

async function handlePostDelivery(contact, text) {
  const phone = contact.phone;
  if (text.includes('basico') || text.includes('básico') || text.includes('oro') || text.includes('diamante') || text.includes('pack')) {
    const history = db.getRecentMessages(phone, 6);
    const reply = await carolRespond(history, text);
    await sendAndSave(phone, reply);
  } else {
    const history = db.getRecentMessages(phone, 6);
    const reply = await carolRespond(history, text);
    await sendAndSave(phone, reply);
  }
}

async function sendAndSave(phone, text) {
  const wamid = await sendText(phone, text);
  db.saveMessage(phone, 'out', 'text', text, wamid);
}

module.exports = { processMessage, sendAndSave };
