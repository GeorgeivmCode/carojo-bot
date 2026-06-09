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
  MOSTRARIO_TRIGGERS, TESTIMONIOS_TRIGGERS, deliveryMessage,
  UPSELL_BASICO, UPSELL_ORO, UPGRADE_CHOICE_BASICO, UPGRADE_PAYMENT_DETAILS
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

// Retorna true si la fecha del comprobante NO es hoy (Colombia)
// Solo actua cuando puede parsear con certeza — si no, retorna false para no rechazar pagos validos
function isFechaAnterior(fechaText) {
  if (!fechaText) return false;
  const text = fechaText.toLowerCase().replace(/,/g, '');

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); // YYYY-MM-DD
  const [hoyAnio, hoyMes, hoyDia] = hoy.split('-').map(Number);

  const meses = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };

  // Formato: "04 de mayo de 2026" o "4 de mayo de 2026 a las 07:07 p.m."
  const m1 = text.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i);
  if (m1) {
    const dia  = parseInt(m1[1]);
    const mes  = meses[m1[2].toLowerCase()];
    const anio = parseInt(m1[3]);
    return dia !== hoyDia || mes !== hoyMes || anio !== hoyAnio;
  }

  // Formato: "29/05/2026" o "29-05-2026"
  const m2 = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m2) {
    const dia  = parseInt(m2[1]);
    const mes  = parseInt(m2[2]);
    const anio = parseInt(m2[3]);
    return dia !== hoyDia || mes !== hoyMes || anio !== hoyAnio;
  }

  // No se pudo parsear — no rechazar para evitar falsos rechazos
  return false;
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

const GIFT_NAMES = {
  resina:      'Arte en Resina Epoxica',
  globoflexia: 'Globoflexia y Decoracion',
  bordados:    'Bordados Florales'
};

const GIFT_MSGS = {
  resina: `Tu curso de regalo *Arte en Resina Epoxica* ya esta activo! 🌟

Con este curso vas a aprender a crear piezas unicas en resina — desde aretes y accesorios hasta cuadros decorativos que puedes vender. Es un negocio increible que complementa perfecto el lettering!

Aqui esta tu acceso:`,
  globoflexia: `Tu curso de regalo *Globoflexia y Decoracion* ya esta activo! 🎈

Con este curso vas a aprender a hacer arreglos, figuras y decoraciones con globos — un servicio muy solicitado para fiestas y eventos que te puede dar ingresos desde el primer fin de semana!

Aqui esta tu acceso:`,
  bordados: `Tu curso de regalo *Bordados Florales* ya esta activo! 🌸

Con este curso vas a aprender bordados a mano con flores, hojas y texturas — piezas que tienen muchisima demanda en mercados y tiendas en linea. Perfecto para combinar con tu arte en lettering!

Aqui esta tu acceso:`
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

  if (eResina)  return 'resina';
  if (eGlobo)   return 'globoflexia';
  if (eBordado) return 'bordados';
  return null;
}

const JORGE_PHONE     = process.env.JORGE_PHONE;
const META_PIXEL_ID      = process.env.META_PIXEL_ID;       // WABA dataset 891673903214904
const META_WEBSITE_PIXEL = '1045311689986665';              // pixel sitio web (fallback sin ctwa_clid)
const META_CAPI_TOKEN    = process.env.META_CAPI_TOKEN;
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
    const ud = { ph: [sha256(rawPhone)], external_id: [sha256(rawPhone)] };

    // Email mejora EMQ de ~4 a 8+ — es la señal mas fuerte despues de ctwa_clid
    if (contact.email) ud.em = [sha256(contact.email)];

    // Nombre (primer token) si existe
    if (contact.name) {
      const fn = contact.name.split(' ')[0];
      if (fn) ud.fn = [sha256(fn)];
    }

    // business_messaging requiere whatsapp_business_account_id (NO page_id — el dataset WABA no tiene pagina vinculada)
    ud.whatsapp_business_account_id = '575088162209889';

    if (contact.ctwa_clid) {
      ud.ctwa_clid = contact.ctwa_clid;
      // fbc no es valido en business_messaging (error 2804064) — solo va en eventos de website
    }

    const customData = {
      currency:     'COP',
      value:        PACK_PRICES[pack] || 0,
      content_name: pack,
      content_type: 'product',
      content_ids:  [pack],
      contents:     [{ id: pack, quantity: 1 }]
    };
    const eventId = `purchase_${contact.phone}_${Date.now()}`;

    const signals = [
      'ph=si',
      contact.email     ? 'em=si' : 'em=NO',
      contact.name      ? 'fn=si' : 'fn=NO',
      contact.ctwa_clid ? 'ctwa_clid=si' : 'ctwa_clid=NO'
    ].join(' | ');

    const postEvent = async (eventObj, label) => {
      const r = await axios.post(
        `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`,
        { data: [eventObj] },
        { params: { access_token: META_CAPI_TOKEN }, timeout: 10000 }
      );
      console.log(`CAPI ${label} ok:`, JSON.stringify(r.data));
    };

    if (contact.ctwa_clid) {
      // Intenta business_messaging (aparece en columna compras de Messi en Ads Manager)
      // Si el dataset WABA no tiene página asociada (error 2804131), cae a "other" con ctwa_clid
      const bmEvent = {
        event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000),
        action_source: 'business_messaging', messaging_channel: 'whatsapp',
        event_id: eventId, user_data: ud, custom_data: customData
      };
      try {
        console.log(`CAPI WABA business_messaging: pack=${pack} phone=${contact.phone} | ${signals}`);
        await postEvent(bmEvent, 'WABA bm');
      } catch (bmErr) {
        const sub = bmErr.response?.data?.error?.error_subcode;
        if (sub === 2804131) {
          // Dataset WABA no tiene página asociada — fallback a "other" con ctwa_clid para matching
          const otherEvent = {
            event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000),
            action_source: 'other',
            event_id: eventId + '_fb', user_data: ud, custom_data: customData
          };
          console.log(`CAPI fallback other (2804131 - sin página en dataset): pack=${pack} phone=${contact.phone}`);
          await postEvent(otherEvent, 'WABA other-fallback');
        } else {
          throw bmErr;
        }
      }
    } else {
      // Sin ctwa_clid — action_source other al WABA dataset
      const event = {
        event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000),
        action_source: 'other',
        event_id: eventId, user_data: ud, custom_data: customData
      };
      console.log(`CAPI WABA other (sin ctwa_clid): pack=${pack} phone=${contact.phone} | ${signals}`);
      await postEvent(event, 'WABA other');
    }
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
  } catch (e) {
    console.error('Sheets error:', e.message);
    try { await notifyJorge(contact, `ALERTA: Venta no registrada en Sheet!\nPack: ${pack}\nEmail: ${email}\nTel: ${contact.phone}\nError: ${e.message}`); } catch (_) {}
  }
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

  let text = (msgType === 'text' ? content : '').trim().toLowerCase();
  // Normalizar "opcion 1/2/3" / "opción 1/2/3" → solo el numero para deteccion en handlers
  const opcionMatch = text.match(/opci[oó]n\s*([123])/);
  if (opcionMatch) text = opcionMatch[1];

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
  if (text === 'salir') {
    db.updateContact(phone, { state: 'stopped' });
    await sendAndSave(phone, STOPPED_MSG);
    return;
  }

  // Cliente que dijo Salir antes pero vuelve a escribir
  if (contact.state === 'stopped') {
    // Palabras de cierre cortes — el cliente solo esta respondiendo "gracias" al STOPPED_MSG
    const CIERRE_CORTÉS = ['gracias', 'ok', 'okay', 'okey', 'bien', 'perfecto', 'de nada',
      'entendido', 'chao', 'bye', 'adios', 'adiós', 'hasta luego', 'claro', 'genial',
      'super', 'excelente', 'listo', 'dale', 'bueno', 'jaja', 'jeje', '👍', '✅', '🙏'];
    const esCierreCortés = CIERRE_CORTÉS.some(p => text === p || text === p + '!' || text === p + '.');
    if (esCierreCortés) return; // Ignorar — no reiniciar el flujo

    // Cualquier otro mensaje = intención de compra o retomar — reiniciar flujo
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
    if (contact.state === 'delivered') {
      await sendAndSave(phone, 'Ya recibí tu mensaje. Un momento que te ayudo con eso. 🙏');
      db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
      await notifyJorge(contact, `SOPORTE POST-VENTA (envió imagen):\nTel: ${phone}\nNombre: ${contact.name || '-'}`);
      return;
    }
    if (ACTIVE_PAYMENT_STATES.has(contact.state) || contact.state === 'new' || contact.state === 'awaiting_choice' || contact.state === 'awaiting_upgrade_comprobante') {
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
      if (contact.state === 'awaiting_upgrade_comprobante') {
        await handleUpgradeComprobante(contact, msgType, content);
      } else {
        await handleComprobante(contact, content);
      }
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
  // IMPORTANTE: solo disparar antes del switch si la peticion es CLARAMENTE visual
  // Para preguntas conceptuales (que incluye, metodologia, bonos) Carol responde primero
  // y el mostrario se agrega como complemento despues de la respuesta de Carol
  let sendMostrarioAfter = false;
  let sendTestimoniosAfter = false;
  if (msgType === 'text') {
    const tl = text.toLowerCase();
    if (MOSTRARIO_TRIGGERS.some(t => tl.includes(t))) {
      sendMostrarioAfter = true;
    }
    if (TESTIMONIOS_TRIGGERS.some(t => tl.includes(t))) {
      sendTestimoniosAfter = true;
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
      // Curiosidad por el regalo del Diamante — solo si tiene Basico seleccionado
      if (contact.pack_selected === 'basico') {
        const isGiftCuriosity = ['regalo', 'cual es', 'cuál es', 'de que se trata', 'de qué se trata',
          'cuentame', 'cuéntame', 'me cuentas', 'que tiene', 'qué tiene', 'que es ese',
          'que sorpresa', 'qué sorpresa', 'que es lo que', 'qué es lo que'].some(w => text.includes(w));
        if (isGiftCuriosity) {
          await sendAndSave(phone,
            'El regalo es exclusivo del MEGA PACK DIAMANTE 💎\n\nEscoges TU MISMA uno de estos 3 cursos completos totalmente gratis:\n🌸 Bordados Florales\n✨ Resina Epoxica\n🎈 Globoflexia y Decoracion\n\nCada uno vale mas de $30.000 por fuera. Con el Diamante son $15.000 en total, llevas 5 cursos, 11 bonos y el curso de regalo que elijas.\n\nTe interesa? Escribe DIAMANTE y te activo todo 💛'
          );
          break;
        }
      }
      // Cambio de pack en medio del flujo — directo al pago, sin upsell
      const wantsDiamante = text === '1' || text.includes('diamante') || text.includes('mega') ||
        ['15 mil', '15mil', 'quince mil', '15.000', 'de 15', 'los 15', 'por 15'].some(p => text.includes(p));
      const wantsOro = !wantsDiamante && (text === '2' || text.includes('oro') || text.includes('super') || text.includes('superpack') ||
        ['10 mil', '10mil', 'diez mil', '10.000', 'de 10', 'los 10', 'por 10'].some(p => text.includes(p)));
      const wantsBasico = !wantsDiamante && !wantsOro && (text === '3' || text.includes('basico') || text.includes('básico') ||
        ['5 mil', '5mil', 'cinco mil', '5.000', 'de 5', 'los 5', 'por 5'].some(p => text.includes(p)));
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
        // Si ya tiene Diamante y pregunta por Oro → Carol intenta retenerla antes de bajar
        if (contact.pack_selected === 'diamante') {
          const history = db.getRecentMessages(phone, 8);
          const ctx = '[CONTEXTO INTERNO: La clienta YA tiene el MEGA PACK DIAMANTE seleccionado ($15.000) y está preguntando por el Oro. Muéstrale la diferencia de valor — lo que pierde si baja al Oro — e intenta retenerla en Diamante. Si insiste explícitamente en el Oro después de tu explicación, entonces acepta. NO cambies el pack automáticamente.]';
          await sendAndSave(phone, await carol(history, ctx + '\n\nMensaje de la clienta: ' + text));
        } else if (contact.pack_selected !== 'oro') {
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
    case 'awaiting_upgrade_comprobante':
      await handleUpgradeComprobante(contact, msgType, content);
      break;
    default:
      await handleNew(contact, text);
  }

  // Complemento visual: se envia DESPUES de que Carol o el handler respondio
  // Solo si la pregunta fue claramente visual (no para preguntas conceptuales)
  if (sendMostrarioAfter) {
    try { await sendGallery(phone, MOSTRARIO); } catch (e) { console.error('Error mostrario:', e.message); }
  }
  if (sendTestimoniosAfter) {
    try { await sendGallery(phone, TESTIMONIOS); } catch (e) { console.error('Error testimonios:', e.message); }
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

  // Cliente perdido preguntando como funciona → guiar directo a elegir
  const isLost = ['que debo hacer', 'qué debo hacer', 'como lo compro', 'cómo lo compro',
    'que hago', 'qué hago', 'como funciona', 'cómo funciona', 'por donde empiezo',
    'por dónde empiezo', 'como empiezo', 'cómo empiezo'].some(w => text.includes(w));
  if (isLost) {
    await sendAndSave(phone, 'Es muy facil! 😊 Solo escríbeme el número del pack que más te llame la atención:\n\n1️⃣ MEGA PACK DIAMANTE ($15.000)\n2️⃣ SUPERPACK ORO ($10.000)\n3️⃣ PACK BÁSICO ($5.000)\n\nY te cuento todo al instante 💛');
    return;
  }

  // Pregunta larga que menciona un pack = pregunta sobre el producto, no seleccion
  // Criterio: tiene ? Y mas de 5 palabras (ej: "pero si es el pack diamante necesita envio?")
  // NO aplica a selecciones cortas como "diamante?" o "el 1?"
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if ((text.includes('?') || text.includes('¿')) && wordCount > 5) {
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
    return;
  }
  // Seleccion por numero o keywords de pack (logica original)
  const isDiamante = text === '1' || /^1\b/.test(text) || text.includes('diamante') ||
    ['15 mil', '15mil', 'quince mil', '15.000', 'de 15', 'los 15', 'por 15'].some(p => text.includes(p));
  const isOro      = !isDiamante && (text === '2' || /^2\b/.test(text) || text.includes('oro') ||
    ['10 mil', '10mil', 'diez mil', '10.000', 'de 10', 'los 10', 'por 10'].some(p => text.includes(p)));
  const isBasico   = !isDiamante && !isOro && (text === '3' || /^3\b/.test(text) || text === 'basico' || text === 'básico' ||
    ['5 mil', '5mil', 'cinco mil', '5.000', 'de 5', 'los 5', 'por 5'].some(p => text.includes(p)));

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

function hasWord(text, words) {
  const tokens = text.split(/[\s,!?¡¿.;:]+/).filter(Boolean);
  // Frases de varias palabras (ej. "de una") se comparan como substring en el texto original
  return words.some(w => w.includes(' ') ? text.includes(w) : tokens.includes(w));
}

const YES_WORDS = ['si', 'sí', 'dale', 'listo', 'ok', 'claro', 'confirmo', 'confirmado', 'voy', 'perfecto', 'hagalo', 'hagámoslo', 'quiero', 'de una'];
const NO_WORDS  = ['no', 'nop', 'nope', 'negativo', 'paso'];

async function handleOfferedDiamante(contact, text) {
  const phone = contact.phone;
  if (text === '1' || text.includes('diamante') || hasWord(text, YES_WORDS)) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else {
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
  }
}

async function handleOfferedOro(contact, text) {
  const phone = contact.phone;
  if (text === '1' || text.includes('diamante') || hasWord(text, YES_WORDS)) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '2' || text.includes('oro') || hasWord(text, NO_WORDS)) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
  } else {
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
  }
}

async function handleOfferedBasico(contact, text) {
  const phone = contact.phone;
  // "no alcanzo/puedo/tengo" = no puede pagar hoy, no es seleccion de pack — va a Carol
  const cantAfford = ['alcanzo', 'no me alcanza', 'no tengo plata', 'no tengo dinero',
    'no tengo para', 'no me llega para', 'no puedo pagar'].some(w => text.includes(w));
  if (cantAfford) {
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
    return;
  }
  const PRECIO_DIAMANTE = ['15 mil', '15mil', 'quince mil', '15.000', '$15', 'de 15', 'los 15', 'por 15'];
  const PRECIO_ORO      = ['10 mil', '10mil', 'diez mil', '10.000', '$10', 'de 10', 'los 10', 'por 10'];
  const PRECIO_BASICO   = ['5 mil', '5mil', 'cinco mil', '5.000', '$5', 'de 5', 'los 5', 'por 5'];
  const mentionsDiamante = text === '1' || text.includes('diamante') || PRECIO_DIAMANTE.some(p => text.includes(p));
  const mentionsOro      = !mentionsDiamante && (text === '2' || text.includes('oro') || text.includes('superpack') || PRECIO_ORO.some(p => text.includes(p)));
  const mentionsBasico   = !mentionsDiamante && !mentionsOro && (text === '3' || text.includes('basico') || text.includes('básico') || PRECIO_BASICO.some(p => text.includes(p)));

  if (mentionsDiamante) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  // Si menciona basico Y oro al mismo tiempo → prefiere oro (el cliente se confundió pero quiere el mayor)
  } else if (mentionsBasico && mentionsOro) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
  // Basico explícito sin oro — va ANTES de YES_WORDS
  } else if (mentionsBasico) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'basico' });
    const rechazaUpsell = text.includes('no gracias') || text.includes('no, gracias') || hasWord(text, NO_WORDS);
    if (rechazaUpsell) await sendAndSave(phone, 'Sin problema! Aqui van los datos para tu Pack Basico 📖');
    await sendAndSave(phone, BASICO_DETAILS);
    await sendAndSave(phone, 'Ah, y solo para que lo sepas... el MEGA PACK DIAMANTE tiene un regalo adicional que no te hemos contado todavia 🤫\n\nSi en algun momento quieres saber de que se trata, me preguntas y te cuento 💎');
  } else if (mentionsOro || hasWord(text, YES_WORDS)) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
  } else if (hasWord(text, NO_WORDS)) {
    // Dice "no" al upsell sin especificar pack → confirma básico (ya lo eligió antes)
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'basico' });
    await sendAndSave(phone, 'Sin problema! Aqui van los datos para tu Pack Basico 📖');
    await sendAndSave(phone, BASICO_DETAILS);
    await sendAndSave(phone, 'Ah, y solo para que lo sepas... el MEGA PACK DIAMANTE tiene un regalo adicional que no te hemos contado todavia 🤫\n\nSi en algun momento quieres saber de que se trata, me preguntas y te cuento 💎');
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
    } else if (razon_rechazo === 'confirmacion_previa') {
      await sendAndSave(phone, 'Si, esos datos estan perfectos! 💛 Ya puedes darle "Enviar". Cuando te aparezca la pantalla de confirmacion del pago me la mandas aqui y listo. 📲');
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

  // Capa de seguridad: verificar fecha en codigo independientemente del modelo
  // El modelo Haiku puede fallar en rechazar comprobantes de dias anteriores
  if (result.fecha && isFechaAnterior(result.fecha)) {
    await sendAndSave(phone, PLANTILLA_ACCESO);
    db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
    await notifyJorge(contact,
      `CLIENTE ANTIGUO (comprobante con fecha pasada — detectado por codigo):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nFecha comprobante: ${result.fecha}`
    );
    return;
  }

  // Normalizar monto — Vision puede retornar "15.000" (string con punto) en vez de 15000
  const rawMonto = result.monto;
  // Normalizar monto colombiano: "15.000,00" (BBVA) o "15.000" o 15000 → 15000
  // Paso 1: quitar parte decimal (,XX al final) — evita que "15.000,00" → 1500000
  // Paso 2: quitar puntos separadores de miles
  const normalizedMonto = rawMonto != null
    ? parseInt(String(rawMonto).replace(/,\d*$/, '').replace(/\./g, ''), 10) || null
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
    // Cierre/confirmacion — cliente acaba de recibir la solicitud de email, aun no lo da
    const CLOSING_EMAIL = ['listo', 'ok', 'gracias', 'perfecto', 'entendido', 'dale', 'claro'];
    if (CLOSING_EMAIL.some(w => rawText === w)) return; // ignorar silenciosamente

    // Dice explícitamente que no tiene Gmail o que está lleno
    const sinGmail = ['no tengo gmail', 'no tengo correo', 'no tengo email', 'no hay espacio',
      'sin espacio', 'esta lleno', 'está lleno', 'llena de correo', 'no cabe', 'lleno de correo',
      'no tengo cuenta', 'no me llega correo'];
    if (sinGmail.some(p => rawText.includes(p))) {
      await sendAndSave(phone,
        'No te preocupes! El acceso no ocupa espacio en tu Gmail — el material vive en nuestro Google Drive, no en tu bandeja de entrada. Solo necesitamos el correo para registrar tu acceso.\n\nEscribenos tu Gmail completo:\ntunombre@gmail.com 📩'
      );
      return;
    }

    // Tiene @ pero no es Gmail válido
    if (email.includes('@') && !isValidGmail(email)) {
      await sendAndSave(phone, INVALID_EMAIL_MSG);
      return;
    }

    // Todo lo demás (deferral, confusión, preguntas, etc.) → Carol con historial completo
    // Contexto invisible: recordarle a Carol que la clienta ya pagó y solo necesita el Gmail
    const history = db.getRecentMessages(phone, 8);
    const ctxEmail = '[CONTEXTO INTERNO: Esta clienta YA PAGÓ su pack. Está en el paso final de dar su Gmail para recibir el acceso. NO ofrezcas packs ni preguntes qué pack quiere. Solo ayúdala a conseguir o escribir su correo Gmail.]';
    const reply = await carol(history, ctxEmail + '\n\nMensaje de la clienta: ' + emailText);
    await sendAndSave(phone, reply);
    return;
  }

  const pack = contact.pack_selected || 'basico';

  try {
    await grantDriveAccess(email, pack);
  } catch (e) {
    console.error('Drive access error:', e.message);
    await sendAndSave(phone, 'Hubo un problema al darte acceso. Ya le avise a nuestro equipo y lo resuelven en minutos!');
    await notifyJorge(contact, `ERROR acceso Drive:\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nError: ${e.message}`);
    return;
  }

  const accessToken = generateAccessToken(phone, pack);
  const accessUrl = `${BOT_URL}/acceso/${accessToken}`;
  await sendAndSave(phone, deliveryMessage(pack, accessUrl));
  db.updateContact(phone, { state: 'delivered', tag: 'Facturado', delivered_at: db.now(), email });
  const updatedContact = db.getContact(phone);

  await fireCapi(updatedContact, pack);
  await logSaleToSheets(contact, pack, email);
  await notifyJorge(contact,
    `ENTREGA completada!\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nNombre: ${contact.name || '-'}`
  );

  // Upsell post-entrega — solo para basico y oro, 2 minutos despues
  if (pack !== 'diamante') {
    setTimeout(async () => {
      try {
        const fresh = db.getContact(phone);
        if (fresh && fresh.state === 'delivered' && !fresh.upsell_sent) {
          const msg = pack === 'basico' ? UPSELL_BASICO : UPSELL_ORO;
          await sendAndSave(phone, msg);
          db.updateContact(phone, { upsell_sent: 1 });
        }
      } catch (e) { console.error('Upsell error:', e.message); }
    }, 2 * 60 * 1000);
  }
}

async function handlePostDelivery(contact, text) {
  const phone = contact.phone;

  // Cliente entregado que vuelve desde un anuncio — reiniciar flujo como nuevo
  if (text === 'quiero el curso de timoteo') {
    db.updateContact(phone, { state: 'new', bot_active: 1, r1_sent: 0, r2_sent: 0 });
    contact = db.getContact(phone);
    await handleNew(contact, text);
    return;
  }

  // Pre-upsell: cierre cortés post-entrega — evitar que Carol responda varias veces a "Gracias"
  if (!contact.upsell_sent && contact.pack_selected !== 'diamante') {
    const DELIVERY_CLOSINGS = ['gracias', 'ok', 'listo', 'perfecto', 'de nada', 'dale', 'bien', 'bueno', 'entendido', 'claro'];
    const isDeliveryClosure = DELIVERY_CLOSINGS.some(w => text === w) || ['adios', 'adiós', 'chao', 'bye'].some(w => text.includes(w));
    if (isDeliveryClosure) {
      const recentMsgs = db.getRecentMessages(phone, 4);
      const lastBot = recentMsgs.filter(m => m.direction === 'out')[0];
      const alreadyAnswered = lastBot && ['de nada', 'disfruta', 'abrazo', 'ánimo', 'animo', 'cualquier duda', 'cualquier cosa'].some(w => lastBot.content.toLowerCase().includes(w));
      if (!alreadyAnswered) {
        await sendAndSave(phone, 'De nada! 💛 Cualquier duda con el material me escribes.');
      }
      return;
    }
  }

  // Upsell: cliente respondio al mensaje de agregar cursos
  if (contact.upsell_sent && !contact.upgrade_target && contact.pack_selected !== 'diamante') {

    // Si ya se envio la semilla de duda y vuelve a rechazar → despedida amable
    const recentMsgs = db.getRecentMessages(phone, 4);
    const lastBot = recentMsgs.filter(m => m.direction === 'out')[0];
    const yaSemilla = lastBot && lastBot.content.includes('Cuando quieras puedes completarlo al MEGA PACK DIAMANTE');

    // Despedida o cierre cortés — no re-activar upsell (ej: "Listo", "Ok, adios", "Gracias", "Chao")
    const isFarewell = ['adios', 'adiós', 'chao', 'bye', 'hasta luego', 'nos vemos'].some(w => text.includes(w));
    const isClosingOnly = text === 'listo' || text === 'ok' || text === 'gracias' || text === 'perfecto' ||
      text === 'entendido' || text === 'claro' || text === 'bueno' || text === 'bien' ||
      text === 'de nada' || text === 'dale' || text === 'jajaja' || text === 'jaja' || text === '👍';
    if (isFarewell || isClosingOnly) {
      if (yaSemilla) {
        await sendAndSave(phone, 'Perfecto! 💛 Que disfrutes mucho tu pack. Aqui estaremos cuando lo necesites. Hasta pronto! 🌸');
        return;
      }
      if (contact.pack_selected === 'basico') {
        await sendAndSave(phone, 'Entendido! 💛 Disfruta tu Pack Basico. Cuando quieras puedes completarlo al MEGA PACK DIAMANTE — 4 cursos mas + un curso de regalo GRATIS que escoges tu misma. Solo escríbeme y lo vemos 💎');
      } else {
        await sendAndSave(phone, 'Entendido! 💛 Disfruta tu SUPERPACK ORO. Cuando quieras puedes completarlo al MEGA PACK DIAMANTE — 4 cursos adicionales + un curso de regalo GRATIS a tu eleccion. Solo escríbeme y lo activamos 💎');
      }
      return;
    }
    // Dudoso: quiere pero aplaza — urgencia con regalo si va al Diamante
    const isDelaying = ['después', 'despues', 'luego', 'mas tarde', 'más tarde', 'mañana', 'manana',
      'ahorita', 'pensarlo', 'le aviso', 'aviso', 'otro dia', 'otro día',
      'por el momento', 'por ahora', 'de momento', 'asi estoy bien', 'así estoy bien',
      'estoy bien asi', 'estoy bien así'].some(w => text.includes(w));
    if (isDelaying) {
      if (contact.pack_selected === 'basico') {
        await sendAndSave(phone,
          'Claro! Te queda guardado el cupo 💛\n\nSolo recuerda que el MEGA PACK DIAMANTE tiene un curso de regalo GRATIS que es solo por hoy — escoges TU MISMA entre:\n🌸 Bordados Florales\n✨ Resina Epoxica\n🎈 Globoflexia y Decoracion\n\nCuando estes lista me escribes y lo vemos 💎'
        );
      } else {
        await sendAndSave(phone,
          'Claro! Te queda guardado el cupo 💛 Solo recuerda que el precio especial es por hoy. Cuando estes lista me escribes y te activo todo al instante 💎'
        );
      }
      return;
    }
    const wantsUpgrade = hasWord(text, YES_WORDS) || ['quiero', 'completar', 'agregar', 'mas cursos',
      'me interesa', 'cuanto', 'cuánto', 'si quiero', 'sí quiero',
      'comprobante', 'ya pague', 'ya pagué', 'te mando', 'ahi va', 'ahí va',
      'voy a pagar', 'como pago', 'cómo pago', 'datos de pago', 'numero de cuenta',
      'nequi', 'daviplata'].some(w => text.includes(w));
    // Soporte post-venta — detectar antes del rechazo para no confundir "no me llegó" con "no quiero"
    const needsSupport = ['no me llegó', 'no me llego', 'no llegó', 'no llego', 'no recibí', 'no recibi',
      'no tengo acceso', 'no puedo abrir', 'no me aparece', 'no funciona', 'no abre',
      'no me ha llegado', 'no me mandaron', 'no encuentro', 'no me dio'].some(w => text.includes(w));
    if (needsSupport) {
      const history = db.getRecentMessages(phone, 8);
      await sendAndSave(phone, await carol(history, text));
      return;
    }
    const rejectsUpgrade = hasWord(text, NO_WORDS) || ['no gracias', 'no quiero', 'no por ahora', 'asi estoy bien', 'estoy bien asi', 'no me interesa'].some(w => text.includes(w));
    if (rejectsUpgrade) {
      if (yaSemilla) {
        await sendAndSave(phone, 'Perfecto! 💛 Que disfrutes mucho tu pack. Aqui estaremos cuando lo necesites. Hasta pronto! 🌸');
        return;
      }
      if (contact.pack_selected === 'basico') {
        await sendAndSave(phone, 'Entendido! 💛 Disfruta tu Pack Basico. Cuando quieras puedes completarlo al MEGA PACK DIAMANTE — 4 cursos mas + un curso de regalo GRATIS que escoges tu misma. Solo escríbeme y lo vemos 💎');
      } else {
        await sendAndSave(phone, 'Entendido! 💛 Disfruta tu SUPERPACK ORO. Cuando quieras puedes completarlo al MEGA PACK DIAMANTE — 4 cursos adicionales + un curso de regalo GRATIS a tu eleccion. Solo escríbeme y lo activamos 💎');
      }
      return;
    }
    if (wantsUpgrade) {
      if (contact.pack_selected === 'basico') {
        // Si ya menciona un pack especifico, ir directo
        if (text.includes('diamante') || text === '1') {
          db.updateContact(phone, { upgrade_target: 'diamante', state: 'awaiting_upgrade_comprobante' });
          await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(10000, 'MEGA PACK DIAMANTE'));
        } else if (text.includes('oro') || text === '2') {
          db.updateContact(phone, { upgrade_target: 'oro', state: 'awaiting_upgrade_comprobante' });
          await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(5000, 'SUPERPACK ORO'));
        } else {
          await sendAndSave(phone, UPGRADE_CHOICE_BASICO);
        }
        return;
      } else if (contact.pack_selected === 'oro') {
        db.updateContact(phone, { upgrade_target: 'diamante', state: 'awaiting_upgrade_comprobante' });
        await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(5000, 'MEGA PACK DIAMANTE'));
        return;
      }
    }
    // Despues del UPGRADE_CHOICE_BASICO, cliente elige pack
    if (contact.pack_selected === 'basico' && !contact.upgrade_target) {
      if (text.includes('diamante') || text === '1') {
        db.updateContact(phone, { upgrade_target: 'diamante', state: 'awaiting_upgrade_comprobante' });
        await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(10000, 'MEGA PACK DIAMANTE'));
        return;
      }
      if (text.includes('oro') || text === '2') {
        db.updateContact(phone, { upgrade_target: 'oro', state: 'awaiting_upgrade_comprobante' });
        await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(5000, 'SUPERPACK ORO'));
        return;
      }
    }
  }

  if (contact.pack_selected === 'diamante') {
    if (!contact.gift_sent) {
      // Cliente elige su regalo → entregar con mensaje coherente
      const giftKey = detectGiftChoice(text);
      if (giftKey) {
        const msg = GIFT_MSGS[giftKey];
        const url = GIFT_URLS[giftKey];
        await sendAndSave(phone, `${msg}\n\n${url}\n\nAbrelo con el correo que usaste para el pack. Cualquier cosa me cuentas aqui! 💛`);
        db.updateContact(phone, { gift_sent: 1 });
        return;
      }
      // Cliente pregunta por el regalo en general → ofrecer opciones
      if (isAskingForGift(text)) {
        await sendAndSave(phone, GIFT_OFFER_MSG);
        return;
      }
    } else {
      // Cliente ya tiene su regalo — solo si pide EXPLICITAMENTE otro, informar que cuesta $10.000
      // NO activar por mencionar "resina", "bordado" etc. (pueden estar hablando del contenido del pack)
      const wantsAnother = ['otro regalo', 'quiero otro', 'puedo tener otro', 'comprar otro',
        'me das otro', 'y el otro', 'los otros dos', 'otro curso de regalo'].some(w => text.includes(w));
      if (wantsAnother) {
        await sendAndSave(phone,
          'Ya tienes tu curso de regalo activado! 🎁\n\nSi quieres los otros dos, cada uno tiene un costo adicional de $10.000. Son:\n\n🌸 Bordados Florales\n✨ Arte en Resina Epoxica\n🎈 Globoflexia y Decoracion\n\nCual te interesa? Te explico como adquirirlo 💬'
        );
        return;
      }
    }
  }

  const history = db.getRecentMessages(phone, 8);
  const reply = await carol(history, text);
  await sendAndSave(phone, reply);
}

async function handleUpgradeComprobante(contact, msgType, content) {
  const phone = contact.phone;
  const upgradeTarget = contact.upgrade_target;
  const currentPack   = contact.pack_selected;
  if (!upgradeTarget) { db.updateContact(phone, { state: 'delivered' }); return; }

  const diferencial = PACK_AMOUNTS[upgradeTarget] - PACK_AMOUNTS[currentPack];
  const packLabel   = upgradeTarget === 'diamante' ? 'MEGA PACK DIAMANTE' : 'SUPERPACK ORO';

  if (msgType === 'text') {
    const text = content.trim().toLowerCase();

    // Cliente llega desde un anuncio nuevo mientras tenia upgrade pendiente — reiniciar flujo
    if (text === 'quiero el curso de timoteo') {
      db.updateContact(phone, { state: 'new', bot_active: 1, upgrade_target: '', r1_sent: 0, r2_sent: 0 });
      contact = db.getContact(phone);
      await handleNew(contact, text);
      return;
    }

    const isNo = hasWord(text, NO_WORDS) || text.includes('no quiero') || text.includes('mejor no');
    const isDelaying = ['despues', 'después', 'luego', 'mas tarde', 'más tarde',
      'otro dia', 'otro día', 'mañana', 'ahorita', 'ahoritica', 'pensarlo'].some(w => text.includes(w));

    if (isNo) {
      db.updateContact(phone, { upgrade_target: '', state: 'delivered' });
      if (upgradeTarget === 'diamante') {
        const packActual = currentPack === 'basico'
          ? 'Pack Basico'
          : 'SUPERPACK ORO';
        const cursosExtra = currentPack === 'basico' ? 4 : 2;
        await sendAndSave(phone,
          `Sin problema! Ya tienes tu ${packActual} activo y eso es lo importante 💛\n\nCuando quieras puedes subir al MEGA PACK DIAMANTE por $${diferencial.toLocaleString('es-CO')} adicionales y escoger TU MISMA un curso GRATIS:\n🌸 Bordados Florales\n✨ Resina Epoxica\n🎈 Globoflexia y Decoracion\n\nTu pack queda activo pero incompleto — el Diamante tiene ${cursosExtra} cursos mas que siguen esperandote. 😊\n\nAqui estoy cuando lo decidas 💎`
        );
      } else {
        // upgradeTarget === 'oro' desde basico
        await sendAndSave(phone,
          `Sin problema! Ya tienes tu Pack Basico activo y eso es lo importante 💛\n\nCuando quieras puedes subir al SUPERPACK ORO por $${diferencial.toLocaleString('es-CO')} adicionales y llevarte 2 cursos mas. O si prefieres ir directo al MEGA PACK DIAMANTE son $10.000 adicionales y te llevas 4 cursos + 11 bonos + 🎁 un curso de regalo GRATIS.\n\nAqui estoy cuando lo decidas 💎`
        );
      }
    } else if (isDelaying) {
      if (upgradeTarget === 'diamante') {
        await sendAndSave(phone,
          `Claro! Te queda guardado el cupo 💛\n\nSolo recuerda que el curso de regalo GRATIS es solo por hoy — escoges TU MISMA entre:\n🌸 Bordados Florales\n✨ Resina Epoxica\n🎈 Globoflexia y Decoracion\n\nEs nuestra forma de celebrar que diste el paso al Diamante 🎁\n\nCuando estés lista me mandas el comprobante de $${diferencial.toLocaleString('es-CO')} y te activo todo al instante 💎`
        );
      } else {
        // upgradeTarget === 'oro' desde basico
        await sendAndSave(phone,
          `Claro! Te queda guardado el cupo 💛 Solo recuerda que el precio especial es por hoy. Cuando estés lista me mandas el comprobante de $${diferencial.toLocaleString('es-CO')} y te activo al instante 💎`
        );
      }
    } else {
      await sendAndSave(phone, `Para completar al ${packLabel} necesito el comprobante de $${diferencial.toLocaleString('es-CO')}. 📸`);
    }
    return;
  }

  if (msgType !== 'image' && msgType !== 'document') return;

  let imageBuffer, mimeType;
  try {
    const parsed = JSON.parse(content);
    imageBuffer = Buffer.from(parsed.buffer, 'base64');
    mimeType    = parsed.mimeType;
  } catch {
    await sendAndSave(phone, 'No pude abrir la imagen. Intentalo de nuevo. 📸');
    return;
  }

  await sendAndSave(phone, 'Un momento, verificando tu pago... ⏳');

  let result;
  try {
    result = await verifyPayment(imageBuffer, mimeType, upgradeTarget);
  } catch (e) {
    console.error(`verifyPayment upgrade error [${phone}]:`, e.message);
    await sendAndSave(phone, 'Tuve un problema procesando tu imagen. Por favor enviamela de nuevo. 📸');
    return;
  }

  if (!result.valido) {
    const { razon_rechazo, monto } = result;
    if (razon_rechazo === 'comprobante_falso')         await sendAndSave(phone, COMPROBANTE_FALSO_MSG);
    else if (razon_rechazo === 'destinatario_invalido') await sendAndSave(phone, PAYMENT_WRONG_RECIPIENT);
    else if (razon_rechazo === 'transaccion_no_exitosa') await sendAndSave(phone, PAYMENT_NOT_SUCCESSFUL);
    else if (razon_rechazo === 'monto_invalido' || (monto && monto !== diferencial))
      await sendAndSave(phone, PAYMENT_WRONG_AMOUNT(monto, diferencial));
    else await sendAndSave(phone, PAYMENT_REJECTED_MSG(null));
    return;
  }

  // Verificar monto == diferencial
  const rawMonto = result.monto;
  const normalizedMonto = rawMonto != null
    ? parseInt(String(rawMonto).replace(/,\d*$/, '').replace(/\./g, ''), 10) || null
    : null;

  if (normalizedMonto && normalizedMonto !== diferencial) {
    await sendAndSave(phone, PAYMENT_WRONG_AMOUNT(normalizedMonto, diferencial));
    return;
  }

  // Pago valido — revocar pack anterior, dar acceso al nuevo
  const { revokeAccess } = require('./drive');
  if (contact.email && currentPack) {
    try { await revokeAccess(contact.email, currentPack); } catch (e) { console.error('Revoke upgrade:', e.message); }
  }
  try {
    await grantDriveAccess(contact.email, upgradeTarget);
  } catch (e) {
    console.error('Grant upgrade:', e.message);
    await notifyJorge(contact, `ERROR Drive upgrade:\nDe: ${currentPack}\nA: ${upgradeTarget}\nEmail: ${contact.email}\nError: ${e.message}`);
  }

  const accessToken = generateAccessToken(phone, upgradeTarget);
  const accessUrl   = `${BOT_URL}/acceso/${accessToken}`;
  await sendAndSave(phone, deliveryMessage(upgradeTarget, accessUrl));

  db.updateContact(phone, { pack_selected: upgradeTarget, upgrade_target: '', state: 'delivered', tag: 'Facturado' });

  // Si el upgrade fue a Diamante, ofrecer regalo igual que en entrega normal
  if (upgradeTarget === 'diamante') {
    setTimeout(async () => {
      try {
        const fresh = db.getContact(phone);
        if (fresh && fresh.state === 'delivered' && !fresh.gift_sent) {
          await sendAndSave(phone, GIFT_OFFER_MSG);
        }
      } catch (e) { console.error('Gift upgrade error:', e.message); }
    }, 30 * 1000); // 30 segundos después de la entrega
  }

  // Actualizar fila del sheet con el nuevo pack y monto total
  if (GAS_SHEETS_URL) {
    try {
      await axios.post(GAS_SHEETS_URL, {
        action:   'update',
        telefono: phone,
        pack:     upgradeTarget,
        monto:    PACK_PRICES[upgradeTarget] || 0
      }, { timeout: 10000 });
    } catch (e) {
      console.error('Sheets update error:', e.message);
      try { await notifyJorge(contact, `ALERTA: Sheet upgrade no actualizado!\nDe: ${currentPack} → A: ${upgradeTarget}\nEmail: ${contact.email}\nTel: ${phone}\nError: ${e.message}`); } catch (_) {}
    }
  }

  await notifyJorge(contact,
    `PACK COMPLETADO!\nDe: ${currentPack} → A: ${upgradeTarget}\nDiferencial: $${diferencial.toLocaleString('es-CO')}\nEmail: ${contact.email}\nTel: ${phone}\nNombre: ${contact.name || '-'}`
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

module.exports = { processMessage, sendAndSave, fireCapi, logSaleToSheets, notifyJorge, generateAccessToken };
