const crypto = require('crypto');
const db = require('./db');
const { sendText, sendImage } = require('./whatsapp');
const { carolRespond, verifyPayment, extractEmailFromImage, detectUpgradeIntent, detectDistrustIntent, detectOldClientIntent, detectGalleryIntent, detectGalleryOrDistrustIntent, detectGiftIntent, clasificarImagenPostVenta, clasificarMensajePostPago, detectarNoDaCorreo } = require('./carol');

const PACK_AMOUNTS = { basico: 5000, oro: 10000, diamante: 15000 };
const BOT_URL = 'https://bot.carojo.uk';

function generateAccessToken(phone, pack) {
  const ts = Math.floor(Date.now() / 1000);
  const amount = PACK_AMOUNTS[pack] || 5000;
  const data = `${phone}|${pack}|${amount}|${ts}`;
  const secret = process.env.VERIFY_TOKEN || 'carojo_verify_2026';
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex').substring(0, 16);
  return Buffer.from(`${data}|${sig}`).toString('base64url');
}

async function carol(history, text) {
  const golden = db.getGoldenExamples(6);
  const raw = await carolRespond(history, text, golden);
  const parts = raw.split('---SPLIT---').map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : raw;
}
const { grantDriveAccess } = require('./drive');
const axios = require('axios');
const {
  WELCOME_MESSAGE, DIAMANTE_DETAILS, ORO_DETAILS, ORO_UPSELL,
  BASICO_DETAILS, BASICO_UPSELL, PAYMENT_RECEIVED_ASK_EMAIL,
  PLANTILLA_ACCESO, STOPPED_MSG, OLD_CLIENT_TRIGGERS,
  INVALID_EMAIL_MSG, FIND_GMAIL_MSG, ENLACE_SIN_CORREO_MSG, REENVIO_ENLACE_MSG, PAYMENT_REJECTED_MSG, PAYMENT_WRONG_AMOUNT,
  PAYMENT_WRONG_RECIPIENT, PAYMENT_NOT_SUCCESSFUL,
  ACCESO_ACTIVANDO_MSG, ACCESO_DEMORADO_MSG, CORREO_NO_ES_GOOGLE_MSG,
  SEND_COMPROBANTE_MSG, GIFT_OFFER_MSG, COMPROBANTE_FALSO_MSG,
  PAYMENT_OLD_DATE_MSG, MOSTRARIO, TESTIMONIOS,
  deliveryMessage,
  UPSELL_BASICO, UPSELL_ORO, UPGRADE_CHOICE_BASICO, UPGRADE_PAYMENT_DETAILS,
  NEQUI_DOWN_TRIGGERS
} = require('./content');

async function checkNequiStatus() {
  try {
    const res = await axios.get('https://status.nequi.com.co/api/v2/status.json', { timeout: 5000 });
    const { indicator, description } = res.data.status;
    if (indicator === 'none') {
      return 'Revise el estado oficial de Nequi y no reporta fallas en este momento ✅\n\nEl problema puede ser de tu conexion o de la app. Intenta cerrar Nequi por completo y abrirla de nuevo, o revisa tu internet.\n\nSi prefieres, tambien puedes pagar por Daviplata: 3217239198 (Titular: Carol Apolinar) 💛';
    }
    return `Confirmado, Nequi si esta reportando fallas ahora mismo: "${description}" 😕\n\nNo es nada que puedas hacer tu, dale unos minutos y vuelve a intentar. Si prefieres no esperar, puedes pagar por Daviplata: 3217239198 (Titular: Carol Apolinar) 💛`;
  } catch (e) {
    console.error('checkNequiStatus error:', e.message);
    return 'No pude confirmar el estado de Nequi en este momento. Puedes revisarlo tu misma aqui: https://www.nequi.com.co/personas/ayuda/status 👀\n\nMientras tanto, tambien puedes pagar por Daviplata: 3217239198 (Titular: Carol Apolinar) 💛';
  }
}

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
  'ya lo mande', 'ya lo mandé', 'ya lo envie', 'ya lo envié',
  'ya lo transferi', 'ya lo transferí', 'ya lo deposite', 'ya lo deposité',
  'ya envie', 'ya envié', 'ya hice la transferencia', 'te pague', 'te pagué',
  'ya hice el deposito', 'ya deposité', 'ya realice el pago',
  'lo mande', 'lo mandé', 'lo envie', 'lo envié', 'lo transferi', 'lo transferí'
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

  // Formato: "29/05/2026" o "29-05-2026" (DD/MM/YYYY)
  const m2 = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m2) {
    const dia  = parseInt(m2[1]);
    const mes  = parseInt(m2[2]);
    const anio = parseInt(m2[3]);
    return dia !== hoyDia || mes !== hoyMes || anio !== hoyAnio;
  }

  // Formato ingles: "JUN 10 2026" o "Jun 10, 2026" (Wompi/Corresponsal)
  const mesesEn = {
    jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
    jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
    january:1, february:2, march:3, april:4, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12
  };
  const m3 = text.match(/([a-z]+)\s+(\d{1,2})[,\s]+(\d{4})/i);
  if (m3 && mesesEn[m3[1].toLowerCase()]) {
    const mes  = mesesEn[m3[1].toLowerCase()];
    const dia  = parseInt(m3[2]);
    const anio = parseInt(m3[3]);
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

const JORGE_PHONE     = process.env.JORGE_PHONE;
const META_PIXEL_ID      = process.env.META_PIXEL_ID;       // WABA dataset 891673903214904
const META_WEBSITE_PIXEL = '1045311689986665';              // pixel sitio web (fallback sin ctwa_clid)
const META_CAPI_TOKEN    = process.env.META_CAPI_TOKEN;
const GAS_SHEETS_URL  = process.env.GAS_SHEETS_URL;
const GAS_DRIVE_URL   = process.env.GAS_URL;

// Monto → pack
const AMOUNT_TO_PACK = { 5000: 'basico', 10000: 'oro', 15000: 'diamante' };
const PACK_PRICES    = { basico: 5000, oro: 10000, diamante: 15000 };

function isValidGmail(email) {
  return /^[a-zA-Z0-9._%+\-]+@gmail\.com$/i.test(email.trim());
}

const NUMEROS_DESTINO_OK = ['3058989359', '3217239198'];
const NOMBRES_DESTINO_OK = ['jorge vanegas', 'carol apolinar'];

// RESCATE de "destinatario_invalido" cuando el modelo NO logro extraer el numero.
//
// Caso real 8 sep 2026 (Libia, 573167527471): tirilla de PAPEL de Corresponsal Redeban,
// recarga Nequi de $15.000 al 3058989359, titular JORGE VANEGAS, de ese mismo dia. El modelo
// leyo bien el monto, el nombre, la fecha y que fue exitosa, pero dejo "destino" en null porque
// en la tirilla el numero va bajo la etiqueta "Producto:", que no estaba en la lista de campos
// donde el prompt le decia buscar. Termino en revision manual. Reproducido 3 de 3 veces.
//
// Esto NO relaja la seguridad: solo corrige el veredicto y deja que corran igual TODAS las capas
// de codigo que ya existen despues (destinatario y fecha). Si el destinatario de verdad estuviera
// mal, la capa siguiente lo sigue frenando. Y solo entra cuando el modelo dejo el numero VACIO:
// si extrajo un numero y ese numero es de otra persona, aqui no se rescata nada.
//
// Muta result a proposito (igual que el flujo normal lo lee despues) y marca result.rescatado
// para poder avisarle a Jorge que este pago entro por esta via.
function rescatarComprobanteSinNumero(result, phone) {
  if (!result || result.valido) return false;
  if (result.razon_rechazo !== 'destinatario_invalido') return false;

  const textoTodo = Object.values(result).filter(v => typeof v === 'string').join(' ').replace(/\D/g, '');
  const hayNumero = NUMEROS_DESTINO_OK.some(n => textoTodo.includes(n));
  const hayNombre = NOMBRES_DESTINO_OK.some(n => (result.nombre_destinatario || '').toLowerCase().includes(n));
  const montoOk   = !!result.monto && !!AMOUNT_TO_PACK[result.monto];
  const exitosa   = /exito|realizad|aprobad|complet/i.test(result.estado || '');
  const fechaOk   = !result.fecha || !isFechaAnterior(result.fecha);

  // Dos formas de llegar aca, las dos vistas en la misma tirilla real:
  // a) el numero NUESTRO si aparece en el resultado pero el modelo igual dijo invalido
  //    (se contradice solo). Rescatar es seguro: el numero calza exacto con el nuestro.
  // b) el modelo no extrajo ningun numero, pero el nombre del destinatario es el nuestro.
  // Si el modelo extrajo un numero y NO es ninguno de los nuestros, aqui no se rescata nada.
  const seContradice = hayNumero;
  const sinNumeroPeroConNombre = !result.destino && hayNombre;
  if (!(seContradice || sinNumeroPeroConNombre)) return false;
  if (!(montoOk && exitosa && fechaOk)) return false;

  console.log(`Comprobante rescatado [${phone}] (${seContradice ? 'el modelo se contradijo' : 'no extrajo el numero'}): ` +
    `numero=${hayNumero ? 'ok' : 'no'} nombre=${hayNombre ? 'ok' : 'no'} monto=${result.monto} ` +
    `destino=${result.destino || '-'} app=${result.app || '-'} estado=${result.estado || '-'} fecha=${result.fecha || '-'}`);
  result.valido = true;
  result.razon_rechazo = null;
  result.rescatado = true;
  return true;
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
  const finalText = Array.isArray(text) ? text[Math.floor(Math.random() * text.length)] : text;
  const wamid = await sendText(phone, finalText);
  db.saveMessage(phone, 'out', 'text', finalText, wamid);
}

const TELEGRAM_TOKEN    = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_IDS = [8039105555, 1360753733]; // Jorge, Carol

async function notifyTelegram(text) {
  if (!TELEGRAM_TOKEN) return;
  // Promise.allSettled nunca rechaza aunque un chat_id falle — sin este catch individual,
  // una falla de Telegram (bot bloqueado, rate limit, etc.) quedaba sin ningun rastro en logs (14 jul 2026)
  await Promise.allSettled(TELEGRAM_CHAT_IDS.map(chat_id =>
    axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id, text }, { timeout: 8000 })
      .catch(e => console.error(`Telegram notify error [chat_id=${chat_id}]:`, e.response?.data ? JSON.stringify(e.response.data) : e.message))
  ));
}

async function notifyJorge(contact, text) {
  await Promise.allSettled([
    JORGE_PHONE ? sendText(JORGE_PHONE, text).catch(e => console.error('WA notify error:', e.message)) : Promise.resolve(),
    notifyTelegram(text).catch(e => console.error('Telegram notify error:', e.message))
  ]);
}

async function fireCapi(contact, pack) {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) {
    console.warn('CAPI skip: falta META_PIXEL_ID o META_CAPI_TOKEN');
    return;
  }
  try {
    const sha256 = v => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

    // Usuaria con nombre de usuario de WhatsApp (sin numero): su id no es un telefono, no se manda
    // como `ph`; va solo como external_id. Con numero, igual que siempre.
    const tieneNumero = /^\d+$/.test(String(contact.phone || ''));
    const rawPhone = tieneNumero ? contact.phone : '';
    const ud = tieneNumero
      ? { ph: [sha256(rawPhone)], external_id: [sha256(rawPhone)] }
      : { external_id: [sha256(String(contact.phone))] };

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
      tieneNumero ? 'ph=si' : 'ph=NO (usuario sin numero)',
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
      // Ultimo anuncio desde el que escribio (el que usa Meta); si no hay, el primero
      ad_id:     contact.ultimo_ad_id   || contact.ad_id   || '',
      ad_name:   contact.ultimo_ad_name || contact.ad_name || ''
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
  // Normalizar "opcion 1/2/3" / "opción 1/2/3" / "pocion 1/2/3" → solo el numero para deteccion en handlers
  const opcionMatch = text.match(/(?:opci[oó]n|poci[oó]n)\s*([123])/);
  if (opcionMatch) text = opcionMatch[1];
  // Normalizar "el 1/2/3" / "la 1/2/3" → numero (ej: "el 1" → "1")
  const elNumMatch = text.match(/^(?:el|la)\s+([123])\s*$/);
  if (elNumMatch) text = elNumMatch[1];

  // Cliente antiguo sin acceso — en cualquier estado que NO sea compra comprometida
  // awaiting_email se excluye: ya pagó, solo está dando su correo; "no me llega" aquí es por Gmail lleno
  if (msgType === 'text' && !ACTIVE_PAYMENT_STATES.has(contact.state) && contact.state !== 'old_client' && contact.state !== 'delivered' && contact.state !== 'awaiting_email') {
    // OLD_CLIENT_TRIGGERS sigue siendo el detector principal (probado en produccion durante meses).
    // Si ninguna frase coincide y el mensaje es sustancial, Carol es una red de seguridad adicional
    // para casos nuevos no anticipados — nunca reemplaza la lista, solo suma cobertura.
    const oldClientByKeyword = isOldClientTrigger(text);
    const oldClientByCarol = !oldClientByKeyword && text.split(/\s+/).filter(Boolean).length >= 3 &&
      await detectOldClientIntent(db.getRecentMessages(phone, 8), text);
    if (oldClientByKeyword || oldClientByCarol) {
      await sendAndSave(phone, PLANTILLA_ACCESO);
      db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
      await notifyJorge(contact, `CLIENTE ANTIGUO sin acceso${oldClientByCarol ? ' (detectado por Carol)' : ''}:\nTel: ${phone}\nNombre: ${contact.name || '-'}\nMensaje: "${content.substring(0, 100)}"`);
      return;
    }
  }

  // Cliente en estado old_client que vuelve a escribir — no responder automaticamente
  // Si manda imagen, loguear para diagnostico (puede ser comprobante de pago que llego tarde)
  if (contact.state === 'old_client') {
    if (msgType === 'image' || msgType === 'document') {
      console.log(`[IMG-IGNORADA-OLD_CLIENT] phone=${phone} — imagen llegó cuando estado=old_client`);
    }
    return;
  }

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
    if (msgType === 'image' || msgType === 'document') {
      // Imagen desde stopped: reiniciar estado y dejar caer al bloque de imagen abajo
    } else {
      await handleNew(contact, text);
      return;
    }
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
      // Solo tratar como comprobante de upgrade si el cliente YA confirmo por texto que quiere subir de pack
      // (upgrade_target explicito). Sin esa confirmacion, no asumir intencion — puede ser soporte post-venta.
      if (contact.upsell_sent && contact.pack_selected !== 'diamante' && contact.upgrade_target) {
        db.updateContact(phone, { state: 'awaiting_upgrade_comprobante', tag: 'Upgrade' });
        contact = db.getContact(phone);
        await handleUpgradeComprobante(contact, msgType, content);
        return;
      }
      // Red de seguridad: si todavia puede subir de pack pero nunca quedo marcado el upgrade,
      // MIRAR la imagen antes de mandarla a soporte. Si resulta ser un comprobante cuyo monto
      // calza exactamente con un diferencial valido, es un pago de upgrade y hay que procesarlo,
      // no apagar el bot. Caso real Karla (573143577059, 18 ago 2026): pago los $10.000 del
      // upgrade a Diamante y quedo 25 minutos esperando en soporte con el bot apagado.
      if (contact.upsell_sent && contact.pack_selected !== 'diamante') {
        const target = await inferUpgradeFromPayment(contact, content);
        if (target) {
          console.log(`Upgrade detectado por el monto del comprobante [${phone}]: ${contact.pack_selected} -> ${target}`);
          db.updateContact(phone, { upgrade_target: target, state: 'awaiting_upgrade_comprobante', tag: 'Upgrade', ...(target === 'diamante' ? { gift_eligible: 1 } : {}) });
          contact = db.getContact(phone);
          await handleUpgradeComprobante(contact, msgType, content);
          return;
        }
      }
      // Antes, CUALQUIER imagen de una clienta entregada apagaba el bot y escalaba a soporte.
      // Con 30 dias de datos reales (8 sep 2026), de 17 imagenes revisadas una por una: 12 eran
      // problemas de acceso (capturas de Drive, login de Google, error 403) y 2 eran clientas
      // mostrando su trabajo terminado. A una que mando un lettering hermoso el bot se le apago
      // y quedo muda, y de paso se perdio el testimonio y la oportunidad de upsell.
      // Ahora se mira la imagen antes de decidir. Si la clasificacion falla devuelve 'otro',
      // que es exactamente el comportamiento viejo, asi que un error nunca empeora las cosas.
      let tipoImg = 'otro';
      let descImg = '';
      try {
        const parsedImg = JSON.parse(content);
        if (parsedImg.buffer) {
          const cls = await clasificarImagenPostVenta(Buffer.from(parsedImg.buffer, 'base64'), parsedImg.mimeType);
          tipoImg = cls.tipo;
          descImg = cls.descripcion || '';
        }
      } catch (e) { console.error(`Imagen post-venta ilegible [${phone}]:`, e.message); }
      console.log(`Imagen post-venta [${phone}]: tipo=${tipoImg} desc="${descImg}"`);
      // Lo que Carol necesita saber para no responder a ciegas: QUE muestra la imagen.
      // Sin esto (8 sep 2026, Mary 573171594370) la clienta mando una captura de su Gmail
      // redactando un correo y Carol le pidio revisar la Play Store, cuando lo que hacia falta
      // era sacarla del Gmail y mandarla al enlace del chat.
      const loQueMuestra = descImg ? `\nEn la imagen se ve: ${descImg}.` : '';

      if (tipoImg === 'trabajo') {
        // Clienta feliz mostrando lo que hizo. No es soporte: se le celebra, el bot sigue
        // encendido, y se le pide permiso para usarlo como testimonio.
        const history = db.getRecentMessages(phone, 8);
        const ctxTrabajo = `[CONTEXTO INTERNO: Esta clienta YA PAGO y YA TIENE su acceso. Acaba de mandar una FOTO de un trabajo que hizo ella misma con el curso, o de los materiales que compro.${loQueMuestra} NO es un problema ni soporte. Felicitala de corazon y con detalle, con la emocion de alguien que de verdad se alegra por ella. Luego pidele permiso para compartirlo como testimonio con otras alumnas. Cierra preguntandole que quiere aprender o mejorar ahora, para poder guiarla al siguiente curso del material que ya tiene. NUNCA le pidas comprobante ni datos de pago.]`;
        const reply = await carol(history, ctxTrabajo + '\n\n(la clienta mando una foto de su trabajo)');
        await sendAndSave(phone, reply);
        await notifyJorge(contact,
          `TRABAJO DE UNA ALUMNA (no es soporte, el bot sigue activo):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || '-'}\nMando una foto de lo que hizo. Miralo en el panel, sirve como testimonio.`
        );
        return;
      }

      if (tipoImg === 'acceso') {
        // Primero se le reenvia su enlace con los pasos (maximo uno cada 24h). Si ya se le mando
        // hace poco, la atiende Carol mirando lo que muestra la captura.
        if (!reenviadoHaceMenosDe24h(contact) && await reenviarEnlaceAcceso(contact)) {
          await notifyJorge(contact,
            `PROBLEMA DE ACCESO (se le reenvio su enlace automaticamente, el bot sigue activo):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || '-'}\nCorreo: ${contact.email || 'no registrado'}${descImg ? `\nEn la imagen: ${descImg}` : ''}`
          );
          return;
        }
        // Captura de Drive, de login de Google o de un error de permiso. Carol ya tiene todas
        // las reglas correctas de acceso en su contexto, que responda ella en vez de callarse.
        const history = db.getRecentMessages(phone, 8);
        const packLabelAcc = contact.pack_selected === 'diamante' ? 'MEGA PACK DIAMANTE'
          : contact.pack_selected === 'oro' ? 'SUPERPACK ORO'
          : contact.pack_selected === 'basico' ? 'PACK BASICO' : 'tu pack';
        const ctxAcceso = `[CONTEXTO INTERNO: Esta clienta YA PAGO y YA TIENE ACCESO activo a ${packLabelAcc}. Correo registrado: ${contact.email || 'no registrado'}. Acaba de mandar una CAPTURA DE PANTALLA de un problema para entrar al material (puede ser Google Drive, una pantalla de inicio de sesion de Google, que le pide contraseña, "solicitud enviada", o un error de que no tiene acceso).${loQueMuestra} Ayudala a resolverlo con pasos concretos y en orden, uno por mensaje. Lo mas comun y lo primero que debes revisar: que el celular tenga abierta la cuenta de Google correcta (la registrada), porque si tiene otra cuenta abierta Drive le niega el permiso. El segundo mas comun: que abrio el enlace dentro de WhatsApp, y ahi Google falla, tiene que abrirlo en Chrome. El acceso SOLO llega como enlace en este mismo chat, NUNCA por correo. Si la imagen muestra que esta metida en su Gmail o buscando un correo, lo PRIMERO que debes hacer es sacarla de ahi con cariño: explicarle que ahi no hay nada que buscar y llevarla al mensaje del chat que tiene el enlace de su carpeta. NO le pidas comprobante ni datos de pago. Cierra preguntandole que ve exactamente en la pantalla para poder seguir ayudandola.]`;
        const reply = await carol(history, ctxAcceso + '\n\n(la clienta mando una captura de un problema de acceso)');
        await sendAndSave(phone, reply);
        await notifyJorge(contact,
          `PROBLEMA DE ACCESO (Carol esta atendiendo, el bot sigue activo):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || '-'}\nCorreo: ${contact.email || 'no registrado'}\nMando una captura de que no puede entrar. Si ves que no avanza, entra tu al chat.`
        );
        return;
      }

      // 'comprobante' que no calzo como upgrade, u 'otro': se mantiene el comportamiento de antes.
      await sendAndSave(phone, 'Ya recibí tu mensaje. Un momento que te ayudo con eso. 🙏');
      db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
      await notifyJorge(contact, `SOPORTE POST-VENTA (envió imagen${tipoImg === 'comprobante' ? ' que parece un comprobante' : ''}):\nTel: ${phone}\nNombre: ${contact.name || '-'}`);
      return;
    }
    // Estado new o awaiting_choice: procesar comprobante directamente
    // El pack se determina del monto detectado en la imagen (5000→basico, 10000→oro, 15000→diamante)
    // Si ya tenia pack_selected, handleComprobante lo respeta; si no, lo infiere del monto
    if (contact.state === 'new' || contact.state === 'awaiting_choice') {
      db.updateContact(phone, { state: 'awaiting_comprobante' });
      contact = db.getContact(phone);
      await handleComprobante(contact, content);
      return;
    }
    if (ACTIVE_PAYMENT_STATES.has(contact.state) || contact.state === 'awaiting_upgrade_comprobante') {
      if (contact.state === 'awaiting_upgrade_comprobante') {
        await handleUpgradeComprobante(contact, msgType, content);
      } else {
        await handleComprobante(contact, content);
      }
      return;
    }
    if (contact.state === 'awaiting_email') {
      try {
        const parsed = JSON.parse(content);
        const imgBuf = Buffer.from(parsed.buffer, 'base64');
        const extractedEmail = await extractEmailFromImage(imgBuf, parsed.mimeType);
        if (extractedEmail) {
          await handleEmail(contact, extractedEmail);
          return;
        }
      } catch (e) {
        console.error('extractEmailFromImage error:', e.message);
      }
      // No se leyo ningun correo en la imagen. Si todavia no tiene su enlace se le manda; si ya lo
      // tiene, no se le vuelve a pedir el Gmail (eso fue lo que desespero a Paula y a Bibiana).
      const histImg = db.getRecentMessages(phone, 12);
      if (contact.acceso_pendiente_email) {
        // Ya dio su Gmail y el bot esta reintentando activarle el acceso
        await sendAndSave(phone, ACCESO_ACTIVANDO_MSG);
      } else if (yaTieneEnlaceAcceso(contact, histImg)) {
        await sendAndSave(phone, 'Recibí tu imagen 💛 Para entrar no tienes que mandarme nada más: toca el enlace que te envié arriba, dale a *Continuar con Google* y elige tu cuenta. Si no te deja, cuéntame qué te aparece y te ayudo.');
      } else {
        // 14 sep 2026: una imagen sin correo ya no dispara el enlace con el boton de Google (ese
        // enlace es solo para quien dice que no tiene o no quiere dar correo). Se le pide el Gmail.
        await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);
      }
      return;
    }
    // Estado inesperado para imagen — log para diagnostico y guiar al cliente
    console.log(`[IMG-ESTADO-INESPERADO] phone=${phone} state=${contact.state}`);
    await sendAndSave(phone, 'Para procesar tu pago primero necesito que elijas tu pack. Escribe 1, 2 o 3 segun tu eleccion. 😊');
    return;
  }

  // Cliente que vuelve a tocar el anuncio (autofill "quiero el curso de timoteo") --
  // SOLO reiniciar el flujo si ya termino su compra o dejo de hablar (entregado,
  // detenido, cliente antiguo). Bug real confirmado 17 jul 2026: la condicion anterior
  // excluia awaiting_comprobante/awaiting_email pero NO awaiting_choice ni offered_*
  // (ACTIVE_PAYMENT_STATES) -- una clienta a mitad de elegir pack que volvia a tocar
  // el mismo anuncio quedaba reiniciada de cero una y otra vez, sin poder cerrar nunca.
  // Ahora es lista blanca (solo estados realmente terminados/inactivos), no lista negra.
  if (msgType === 'text' && text === 'quiero el curso de timoteo' &&
      ['delivered', 'stopped', 'old_client'].includes(contact.state)) {
    db.updateContact(phone, { state: 'new', bot_active: 1, r1_sent: 0, r2_sent: 0, pack_selected: null, upgrade_target: null, upsell_sent: 0 });
    contact = db.getContact(phone);
    await handleNew(contact, text);
    return;
  }

  // Nequi caido/con fallas — verificar estado real antes de responder (solo en pago activo)
  if (msgType === 'text' && ACTIVE_PAYMENT_STATES.has(contact.state)) {
    const tlNequi = text.toLowerCase();
    if (NEQUI_DOWN_TRIGGERS.some(t => tlNequi.includes(t))) {
      const diagnostico = await checkNequiStatus();
      await sendAndSave(phone, diagnostico);
      return;
    }
  }

  // Deteccion automatica de mostrario y testimonios
  // IMPORTANTE: solo disparar antes del switch si la peticion es CLARAMENTE visual
  // Para preguntas conceptuales (que incluye, metodologia, bonos) Carol responde primero
  // y el mostrario se agrega como complemento despues de la respuesta de Carol
  let sendMostrarioAfter = false;
  let sendTestimoniosAfter = false;
  let mostrarioAlreadySentNote = false;
  let testimoniosAlreadySentNote = false;
  // 'new' bloqueado a proposito: la plantilla de bienvenida (mensaje + 3 packs) es la secuencia
  // de entrada y no debe ir acompañada de nada mas en el primerisimo contacto con la clienta.
  // 'awaiting_comprobante' SI puede disparar mostrario/testimonios (a diferencia de antes) —
  // es justo el momento donde surge la duda real antes de pagar, para eso existen las fotos.
  const stateBlocksGallery = ['new', 'delivered', 'awaiting_email', 'awaiting_upgrade_comprobante', 'old_client'];
  const galleryBlocked = stateBlocksGallery.includes(contact.state) ||
    (contact.pack_selected && ACTIVE_PAYMENT_STATES.has(contact.state) && contact.state !== 'awaiting_comprobante');
  if (msgType === 'text' && !galleryBlocked) {
    // Mostrario y desconfianza se deciden con UNA sola clasificacion (no dos por separado) --
    // reemplaza MOSTRARIO_TRIGGERS y evita el bug real donde dos revisiones independientes
    // podian decir que si las dos para el mismo mensaje ambiguo, mandando mostrario Y
    // testimonios seguidos (7 mensajes en 3 segundos, se ve como spam). Ver detectGalleryOrDistrustIntent.
    // Se corre igual aunque ya se hayan mandado antes en este chat: hace falta saber si esta
    // pidiendolo de NUEVO para avisarle donde ya estan, en vez de quedarse callado.
    const recentForIntent = db.getRecentMessages(phone, 6);
    const { mostrario: wantsGallery, desconfianza: isDistrustful } = await detectGalleryOrDistrustIntent(recentForIntent, text);
    if (wantsGallery) {
      if (contact.mostrario_sent) mostrarioAlreadySentNote = true;
      else sendMostrarioAfter = true;
    }
    if (isDistrustful) {
      if (contact.testimonios_sent) testimoniosAlreadySentNote = true;
      else sendTestimoniosAfter = true;
    }
  }

  // Curso de regalo — SOLO aplica si vino de remarketing R1 (donde se ofrece) o de un upgrade a
  // Diamante (donde tambien se ofrece). Quien compra Diamante directo desde el inicio nunca lo ve
  // mencionado, asi que fuera de estos 2 casos este bloque no hace nada (Carol responde normal, sin
  // contexto de regalo, si alguien pregunta por uno que nunca se le prometio).
  if (msgType === 'text' && (contact.r1_sent || contact.gift_eligible) && !contact.gift_sent && !contact.gift_choice && isAskingForGift(text)) {
    const giftIntent = await detectGiftIntent(db.getRecentMessages(phone, 15), text);
    if (giftIntent.intencion === 'elige' && giftIntent.curso) {
      if (contact.state === 'delivered') {
        const gMsg = GIFT_MSGS[giftIntent.curso];
        const gUrl = GIFT_URLS[giftIntent.curso];
        await sendAndSave(phone, `${gMsg}\n\n${gUrl}\n\nAbrelo con el correo que usaste para el pack. Cualquier cosa me cuentas aqui! 💛`);
        db.updateContact(phone, { gift_sent: 1 });
        return;
      }
      // Todavia no paga — solo se guarda la eleccion, el mensaje sigue su curso normal
      // (puede tambien contener otra peticion, ej. pedir el Nequi)
      db.updateContact(phone, { gift_choice: giftIntent.curso });
    } else if (giftIntent.intencion === 'ver_opciones' && contact.state === 'delivered') {
      await sendAndSave(phone, GIFT_OFFER_MSG);
      return;
    }
    // "pregunta" o "ninguna" → no se responde aqui, sigue el flujo normal (Carol contesta con contexto)
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
      // Cliente escribe "comprobante" como texto (sin imagen) — pedir imagen directamente
      if (text.includes('comprobante') && !text.includes('?') && !text.includes('¿')) {
        await sendAndSave(phone, SEND_COMPROBANTE_MSG);
        break;
      }
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
      // Si en su ultima respuesta Carol le ofrecio subir al pack de arriba y la clienta acepta
      // ("si", "dale, ese"), se cambia el pack y salen los datos del pack nuevo. Solo se mira la
      // ultima respuesta del bot, y nunca el Remarketing 1 (ese ofrece el Diamante a todas).
      const anterior = history.slice(0, -1);
      const turnoBot = [];
      for (let i = anterior.length - 1; i >= 0 && anterior[i].direction === 'out'; i--) turnoBot.unshift(String(anterior[i].content || ''));
      const ofertaBot = turnoBot.join(' ');
      if (['basico', 'oro'].includes(contact.pack_selected) && ofertaBot && !/BONO RELAMPAGO/i.test(ofertaBot)) {
        // El destino es el pack nombrado en la pregunta de cierre (la ultima parte del turno); si
        // nombra los dos, el que aparece de ultimo. Carol cierra nombrando un solo pack.
        const cierre = turnoBot[turnoBot.length - 1];
        const posOro = cierre.search(/\bORO\b(?![\s\S]*\bORO\b)/i);
        const posDiamante = cierre.search(/DIAMANTE(?![\s\S]*DIAMANTE)/i);
        let destino = null;
        if (contact.pack_selected === 'basico' && (posOro >= 0 || posDiamante >= 0)) destino = posDiamante > posOro ? 'diamante' : 'oro';
        if (contact.pack_selected === 'oro' && posDiamante >= 0) destino = 'diamante';
        if (destino) {
          const etiqueta = destino === 'oro' ? 'SUPERPACK ORO' : 'MEGA PACK DIAMANTE';
          const acepta = await detectUpgradeIntent(history, text, etiqueta, PACK_AMOUNTS[destino] - PACK_AMOUNTS[contact.pack_selected]);
          if (acepta) {
            db.updateContact(phone, { pack_selected: destino });
            console.log(`Subio de pack antes de pagar [${phone}] ${contact.pack_selected} -> ${destino}`);
            await sendAndSave(phone, destino === 'oro' ? ORO_DETAILS : DIAMANTE_DETAILS);
            break;
          }
        }
      }
      // Contexto del pack elegido: lo que trae, lo que no trae y el pack de arriba (ver contextoPackElegido)
      const ctxPack = contextoPackElegido(contact.pack_selected);
      const carolText = ctxPack ? `${ctxPack}\n\n${text}` : text;
      await sendAndSave(phone, await carol(history, carolText));
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
    try {
      await sendGallery(phone, MOSTRARIO);
      db.updateContact(phone, { mostrario_sent: 1 });
    } catch (e) { console.error('Error mostrario:', e.message); }
  } else if (mostrarioAlreadySentNote) {
    try {
      await sendAndSave(phone, 'Ay, esas fotos ya te las mande hace un ratico, mira mas arriba en el chat que ahi las tienes! 📸 Si tienes otra dudita con los packs cuentame 💛');
    } catch (e) { console.error('Error nota mostrario:', e.message); }
  }
  if (sendTestimoniosAfter) {
    try {
      await sendGallery(phone, TESTIMONIOS);
      db.updateContact(phone, { testimonios_sent: 1 });
    } catch (e) { console.error('Error testimonios:', e.message); }
  } else if (testimoniosAlreadySentNote) {
    try {
      await sendAndSave(phone, 'Ya te compartí los testimonios de nuestras alumnas mas arriba, dales un vistazo cuando quieras 💛 Cualquier otra duda aquí estoy!');
    } catch (e) { console.error('Error nota testimonios:', e.message); }
  }
}

async function handleNew(contact, text) {
  const phone = contact.phone;
  if (['1', '2', '3'].includes(text)) {
    db.updateContact(phone, { state: 'awaiting_choice' });
    contact = db.getContact(phone);
    await handleChoice(contact, text);
  } else if (contact.pack_selected) {
    // Pack ya elegido pero estado se perdio — recuperar flujo sin mostrar WELCOME_MESSAGE
    console.warn(`[handleNew] Recuperando flujo: phone=${phone} pack=${contact.pack_selected} estado_perdido=${contact.state}`);
    db.updateContact(phone, { state: 'awaiting_comprobante' });
    await sendAndSave(phone, SEND_COMPROBANTE_MSG);
  } else {
    // Bienvenida sin foto (10 sep 2026, noche): la version con la foto "Que encontraras?" en medio
    // se quito a pedido de Jorge porque desde que salio no hubo ventas. Vuelve a ser la original.
    await sendAndSave(phone, WELCOME_MESSAGE);
    db.updateContact(phone, { state: 'awaiting_choice' });
  }
}

async function handleChoice(contact, text) {
  const phone = contact.phone;

  // Pack ya elegido pero estado retrocedió — cliente escribe "comprobante" texto sin imagen
  if (text.includes('comprobante') && !text.includes('?') && !text.includes('¿') && contact.pack_selected) {
    db.updateContact(phone, { state: 'awaiting_comprobante' });
    await sendAndSave(phone, SEND_COMPROBANTE_MSG);
    return;
  }

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
  // Indecision entre varios packs (ej: "1, y 3", "el 2 o el 3") → Carol sin cambiar estado
  const packNumCount = [/\b1\b/.test(text), /\b2\b/.test(text), /\b3\b/.test(text)].filter(Boolean).length;
  if (packNumCount > 1) {
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

  // "Si/dale/listo" sin keyword de pack → inferir del historial reciente cual pack discutia Carol
  const isShortYes = !isDiamante && !isOro && !isBasico &&
    text.split(/\s+/).filter(Boolean).length <= 4 && hasWord(text, YES_WORDS);

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
    // Si la clienta ya pasó por el ciclo básico→oro (vio el BASICO_UPSELL), ir directo a pago
    // sin hacer otro upsell a DIAMANTE — ya fue intentado una vez
    const recentHist = db.getRecentMessages(phone, 15);
    const yaVioBasicoUpsell = recentHist.some(m => m.direction === 'out' && m.content.includes('SUPERPACK ORO') && m.content.includes('PERO ANTES DE CONFIRMAR'));
    if (yaVioBasicoUpsell) {
      db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
      await sendAndSave(phone, ORO_DETAILS);
    } else {
      db.updateContact(phone, { state: 'offered_oro', pack_selected: 'oro' });
      await sendAndSave(phone, ORO_UPSELL);
    }
  } else if (isBasico) {
    db.updateContact(phone, { state: 'offered_basico', pack_selected: 'basico' });
    await sendAndSave(phone, BASICO_UPSELL);
  } else if (isShortYes) {
    // Si el mensaje habla de modalidad/formato → no es seleccion de pack → Carol
    const isModalidadQuery = ['presencial', 'fisico', 'físico', 'en vivo', 'a domicilio', 'domicilio', 'en persona', 'virtual'].some(w => text.includes(w));
    if (isModalidadQuery) {
      const history = db.getRecentMessages(phone, 8);
      await sendAndSave(phone, await carol(history, text));
      return;
    }
    // Inferir pack del historial RECIENTE — solo ultimos 3 mensajes del bot
    // Evita que "si si" en contexto de chitchat dispare detalles de pack por mensajes viejos
    const recent = db.getRecentMessages(phone, 12);
    const recentBotMsgs = recent.filter(m => m.direction === 'out').slice(-3);
    const hist = recentBotMsgs.map(m => m.content).join(' ').toLowerCase();
    if (hist.includes('diamante') || hist.includes('15.000') || hist.includes('quince mil')) {
      db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
      await sendAndSave(phone, DIAMANTE_DETAILS);
    } else if (hist.includes('superpack oro') || hist.includes('10.000') || hist.includes('diez mil')) {
      db.updateContact(phone, { state: 'offered_oro', pack_selected: 'oro' });
      await sendAndSave(phone, ORO_UPSELL);
    } else if (hist.includes('pack básico') || hist.includes('pack basico') || hist.includes('5.000') || hist.includes('cinco mil')) {
      db.updateContact(phone, { state: 'offered_basico', pack_selected: 'basico' });
      await sendAndSave(phone, BASICO_UPSELL);
    } else {
      // No se puede inferir — Carol pide que aclare
      const history = db.getRecentMessages(phone, 8);
      await sendAndSave(phone, await carol(history, text));
    }
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

// Rechazo SOLO si el mensaje es unicamente eso ("no", "no gracias", "no por ahora"...).
// Antes bastaba un mensaje corto con la palabra "no": caso real Brend 573209005984 (10 sep 2026)
// escribio "No lo puedo abrir" despues de la oferta de mas cursos y el bot le contesto
// "Entendido! Disfruta tu pack" en vez de ayudarla. Cualquier otra frase con "no" cae a Carol.
function esSoloRechazo(text) {
  const limpio = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(no|nop|nope|negativo|paso)( (gracias|muchas gracias|mil gracias|por ahora|por el momento|senora|amiga|asi estoy bien|estoy bien asi))*$/.test(limpio);
}

// Lo que trae y lo que NO trae cada pack, para el contexto de Carol despues de la entrega.
// Caso real 10 sep 2026 (573115578810, Oro): Carol le dijo que tenia "los diseños de Canva",
// que son del Diamante. Tampoco podia contarle que puede completar su pack aunque preguntara
// "Que mas venden?", porque tenia prohibido hablar de pagos despues de la entrega.
function detallePackEntregado(pack) {
  const incluye = {
    basico: 'Curso de Lettering y Letra Timoteo con 34 cartillas (+2.400 paginas) y el bono de 500 dibujos para colorear',
    oro: 'Curso de Lettering y Letra Timoteo (34 cartillas), Curso de Marcado de Cuadernos (+300 paginas), Curso de Moldes de cajas, flores y letras 3D, y el bono de 500 dibujos para colorear',
    diamante: 'los 5 cursos (Lettering y Letra Timoteo, Marcado de Cuadernos, Moldes 3D, Papeleria Creativa y Agendas Personalizadas) y los 11 bonos (85.000 diseños editables en Canva, 6 regalos premium, 3 bonos de agendas y 500 dibujos para colorear)'
  };
  const noIncluye = {
    basico: 'Marcado de Cuadernos, Moldes 3D, Papeleria Creativa, los 85.000 diseños de Canva, Agendas Personalizadas ni los 6 regalos premium',
    oro: 'Papeleria Creativa, los 85.000 diseños de Canva, Agendas Personalizadas, los bonos de agendas ni los 6 regalos premium'
  };
  const completar = {
    basico: 'al SUPERPACK ORO por $5.000 adicionales (2 cursos mas) o al MEGA PACK DIAMANTE por $10.000 adicionales (4 cursos mas, 11 bonos y un curso de regalo a su eleccion)',
    oro: 'al MEGA PACK DIAMANTE por $5.000 adicionales (Papeleria Creativa con 85.000 diseños de Canva, Agendas, 6 regalos premium y un curso de regalo a su eleccion)'
  };
  if (!incluye[pack]) return 'NO le pidas que pague, su compra esta completa.';
  if (pack === 'diamante') {
    return `Su pack trae: ${incluye.diamante}. Ya tiene el pack mas completo, no hay nada mas que ofrecerle. NO le pidas que pague, su compra esta completa.`;
  }
  return `Su pack trae: ${incluye[pack]}. Su pack NO trae ${noIncluye[pack]}: NUNCA le digas que tiene algo de eso. ` +
    `NO le pidas que pague lo que ya compro, su compra esta completa. Solo si ELLA pregunta que mas tenemos, que mas venden o quiere mas contenido, ` +
    `puedes contarle UNA vez y sin presionar que puede completar ${completar[pack]}. No le des datos de pago tu: si dice que quiere, el sistema se los manda.`;
}

// Contexto para Carol cuando la clienta YA eligio pack y todavia no paga (14 sep 2026).
// Antes decia solo "ya eligio el PACK BASICO, solo falta el comprobante": caso Juli 573237998457
// pregunto por el curso de Moldes 3D y "que otros cursos tienes?" y Carol le mando los datos de
// pago del Basico, que no trae moldes. Pedido de Jorge: si pregunta que mas vendemos o por algo que
// su pack no trae, hablarle del pack de arriba para subir el ticket, no cerrarla con el que eligio.
function contextoPackElegido(pack) {
  if (pack === 'basico') {
    return '[CONTEXTO INTERNO: Esta clienta eligio el PACK BASICO ($5.000) y todavia no ha pagado. ' +
      'El BASICO trae: Curso de Lettering y Letra Timoteo (34 cartillas, +2.400 paginas) y 500 dibujos para colorear. ' +
      'NO trae: Marcado de Cuadernos, Moldes 3D (cajas, flores, letras), Papeleria Creativa (85.000 diseños en Canva), Agendas Personalizadas ni los regalos premium. ' +
      'El SUPERPACK ORO ($10.000, solo $5.000 mas) suma Marcado de Cuadernos y Moldes 3D. El MEGA PACK DIAMANTE ($15.000, $10.000 mas) trae los 5 cursos y 11 bonos (Canva, agendas, 6 regalos premium). ' +
      'OJO: Papeleria Creativa (Canva) y Agendas SOLO vienen en el DIAMANTE, NUNCA digas que vienen en el ORO. ' +
      'OJO CON LOS PRECIOS: ella eligio el Basico de $5.000, asi que para ELLA el DIAMANTE es $10.000 MAS ($15.000 en total) y el ORO es $5.000 MAS ($10.000 en total). ' +
      'NUNCA le digas "por solo $5.000 mas te llevas el Diamante"; los $5.000 de diferencia son solo entre el ORO y el DIAMANTE, y si lo dices tiene que decir "que el ORO". ' +
      'NO le preguntes que pack quiere desde cero. ' +
      'TU OBJETIVO COMO VENDEDORA: que se lleve el MEGA PACK DIAMANTE; como minimo el SUPERPACK ORO. ' +
      'SI PREGUNTA QUE MAS VENDEMOS, QUE OTROS CURSOS HAY, O POR UN CURSO QUE EL BASICO NO TRAE: NO le mandes los datos de pago del Basico ni le digas que con el Basico ya tiene todo. ' +
      'Recomiendale el MEGA PACK DIAMANTE: por $10.000 mas se lleva TODO (el curso que pregunta, los 5 cursos y los 11 bonos). Si lo que pregunta es Moldes 3D o Marcado de Cuadernos, puedes decirle que tambien vienen en el ORO, pero que por solo $5.000 mas que el Oro el Diamante trae ademas Canva y Agendas. ' +
      'Cierra con UNA sola pregunta nombrando SOLO el pack que le recomiendas (el MEGA PACK DIAMANTE). Si en su respuesta duda por el precio, ahi ofrecele el SUPERPACK ORO como minimo, nombrandolo. ' +
      'Si dice claramente que solo quiere el Basico, respetalo sin insistir y recuerdale suave que falta el comprobante de $5.000.]';
  }
  if (pack === 'oro') {
    return '[CONTEXTO INTERNO: Esta clienta eligio el SUPERPACK ORO ($10.000) y todavia no ha pagado. ' +
      'El ORO trae: Curso de Lettering y Letra Timoteo (34 cartillas), Curso de Marcado de Cuadernos, Curso de Moldes 3D (cajas, flores, letras) y 500 dibujos para colorear. ' +
      'NO trae: Papeleria Creativa (85.000 diseños en Canva), Agendas Personalizadas, los bonos de agendas ni los 6 regalos premium. ' +
      'El MEGA PACK DIAMANTE ($15.000, solo $5.000 mas) trae los 5 cursos y 11 bonos. ' +
      'NO le preguntes que pack quiere desde cero. ' +
      'TU OBJETIVO COMO VENDEDORA: que se lleve el MEGA PACK DIAMANTE. ' +
      'SI PREGUNTA QUE MAS VENDEMOS, QUE OTROS CURSOS HAY, O POR ALGO QUE EL ORO NO TRAE: NO le mandes los datos de pago del Oro. ' +
      'Cuentale corto y con entusiasmo que eso viene en el MEGA PACK DIAMANTE por solo $5.000 mas y cierra con UNA pregunta nombrando el MEGA PACK DIAMANTE. ' +
      'Si dice claramente que se queda con el Oro, respetalo sin insistir y recuerdale suave que falta el comprobante de $10.000.]';
  }
  if (pack === 'diamante') {
    return '[CONTEXTO INTERNO: Esta clienta YA eligio el MEGA PACK DIAMANTE ($15.000), el pack mas completo. Solo necesita enviar el comprobante de pago. NO preguntes que pack quiere, ya esta confirmado. Responde en ese contexto.]';
  }
  return '';
}

// Respuesta corta afirmativa a "Pudiste abrir tu material?" ("si", "si gracias", "ya pude").
// Despues de una pregunta de si/no un "si" corto no es ambiguo; lo largo lo decide el revisor.
function esAfirmacionCorta(text) {
  const limpio = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(s+i+|ya|claro|listo|ok|okey|perfecto|excelente|genial|todo bien|gracias|muchas gracias|mil gracias|ya pude|si pude|ya abri|ya entre|ya me abrio|si ya|ya si|si senora|si senor)( (gracias|muchas gracias|mil gracias|ya pude|todo bien|perfecto|senora|amiga|pude|ya|claro|excelente))*$/.test(limpio);
}

// ¿Ya tiene su enlace de acceso para esta compra? Cuenta el que manda el bot y tambien el que
// manda Jorge a mano con el boton "Enlace acceso" del panel (caso Paula 573223534427: Jorge le
// mando el enlace y Carol le siguio pidiendo el Gmail como si no existiera).
function yaTieneEnlaceAcceso(contact, history) {
  if (contact.enlace_acceso_enviado) return true;
  const desde = contact.awaiting_email_at || '';
  return history.some(m => m.direction === 'out' && typeof m.content === 'string' &&
    m.content.includes('/acceso/') && (!desde || (m.created_at || '') >= desde));
}

// Manda el enlace a la clienta que YA PAGO y no da (o no tiene) Gmail. Una sola vez por compra.
async function enviarEnlaceSinCorreo(contact) {
  if (!contact.pack_selected) return false;
  // Solo para quien esta esperando dar el correo de una compra ya pagada. Nunca a una clienta
  // entregada o antigua: a ellas se les reenvia su enlace de siempre (reenviarEnlaceAcceso).
  if (contact.state !== 'awaiting_email') return false;
  const url = `${BOT_URL}/acceso/${generateAccessToken(contact.phone, contact.pack_selected)}`;
  await sendAndSave(contact.phone, ENLACE_SIN_CORREO_MSG(url));
  db.updateContact(contact.phone, { enlace_acceso_enviado: 1 });
  db.logAdminAction(contact.phone, 'enlace_sin_correo_bot', `pack=${contact.pack_selected}`);
  console.log(`Enlace sin correo enviado [${contact.phone}] pack=${contact.pack_selected}`);
  return true;
}

// Reenvia su enlace a una clienta ya entregada que dice que no puede abrir. Maximo uno cada 24h:
// si vuelve a decir que no puede, ya no se le repite, la atiende Carol y se avisa a Jorge.
function reenviadoHaceMenosDe24h(contact) {
  if (!contact.enlace_reenviado_at) return false;
  const t = new Date(contact.enlace_reenviado_at.replace(' ', 'T') + 'Z').getTime();
  return !isNaN(t) && Date.now() - t < 24 * 3600 * 1000;
}

async function reenviarEnlaceAcceso(contact) {
  if (!contact.pack_selected) return false;
  const url = `${BOT_URL}/acceso/${generateAccessToken(contact.phone, contact.pack_selected)}`;
  await sendAndSave(contact.phone, REENVIO_ENLACE_MSG(url, contact.email));
  db.updateContact(contact.phone, { enlace_reenviado_at: db.now(), ayuda_acceso_avisada: 0 });
  db.logAdminAction(contact.phone, 'enlace_reenviado_bot', `pack=${contact.pack_selected}`);
  console.log(`Enlace reenviado [${contact.phone}] pack=${contact.pack_selected}`);
  return true;
}

// Clienta que ya pago y esta claramente molesta. Desde el 10 sep 2026 (noche) NO se le avisa a
// Jorge al celular (pidio que suene solo por ventas): queda anotado en el historial del contacto
// y Carol la atiende con tacto (NOTA_CLIENTA_MOLESTA).
async function avisarClientaMolesta(contact, text, estadoLabel) {
  if (contact.molesta_avisada) return;
  db.updateContact(contact.phone, { molesta_avisada: 1 });
  db.logAdminAction(contact.phone, 'clienta_molesta', `${estadoLabel}: ${String(text).slice(0, 150)}`);
  console.log(`Clienta molesta [${contact.phone}] (${estadoLabel})`);
}

// Android o iPhone, segun lo que la clienta haya escrito (gana la ultima mencion). '' si no dijo.
// Palabras sin ambiguedad a proposito: "vivo" o "moto" tambien son palabras comunes en español.
function detectarCelular(texto) {
  const t = String(texto || '').toLowerCase();
  const iph = [...t.matchAll(/\b(i\s?phone|iph|ios|apple)\b/g)].pop();
  const andr = [...t.matchAll(/\b(android|androide|samsung|xiaomi|redmi|motorola|huawei|oppo|tecno|honor|realme|infinix)\b/g)].pop();
  if (iph && andr) return iph.index > andr.index ? 'iphone' : 'android';
  return iph ? 'iphone' : andr ? 'android' : '';
}

const NOTA_CLIENTA_MOLESTA = '\n[CONTEXTO INTERNO: LA CLIENTA ESTA MOLESTA. Pidele disculpas UNA sola vez, corto y sincero, asegurale que su compra y su plata estan seguras y que tu la ayudas a resolverlo ya mismo. NO le digas que otra persona del equipo la va a atender. No le discutas ni le repitas instrucciones que ya le diste.]';
// Ya se le reenvio su enlace y sigue sin poder abrir: Carol la sigue ayudando ella misma.
const NOTA_SIGUE_SIN_PODER_ABRIR = '\n[CONTEXTO INTERNO: ESTA CLIENTA SIGUE SIN PODER ABRIR SU MATERIAL aunque ya se le reenvio su enlace. Ayudala TU misma, sin decirle que otra persona la va a ayudar y sin repetirle los pasos que ya le diste. Preguntale UNA cosa para destrabarla: que le aparece exactamente en la pantalla cuando toca el enlace, o que te mande una captura. Las causas mas comunes: abrio el enlace dentro de WhatsApp (debe copiarlo y pegarlo en Chrome o Safari) o tiene abierta en el celular otra cuenta de Google distinta al correo que dio.]';

const YES_WORDS = ['si', 'sí', 'dale', 'listo', 'ok', 'claro', 'confirmo', 'confirmado', 'voy', 'perfecto', 'hagalo', 'hagámoslo', 'quiero', 'de una'];
const NO_WORDS  = ['no', 'nop', 'nope', 'negativo', 'paso'];

async function handleOfferedDiamante(contact, text) {
  const phone = contact.phone;
  const isShortYes = text.split(/\s+/).filter(Boolean).length <= 4 && hasWord(text, YES_WORDS);
  if (text === '1' || text.includes('diamante') || isShortYes) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    const history = db.getRecentMessages(phone, 8);
    await sendAndSave(phone, await carol(history, text));
  }
}

async function handleOfferedOro(contact, text) {
  const phone = contact.phone;
  if (text === '1' || text.includes('diamante')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
    await sendAndSave(phone, DIAMANTE_DETAILS);
  } else if (text === '2' || text.includes('oro')) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
  } else {
    const history = db.getRecentMessages(phone, 8);
    // Mensaje ambiguo (no dice "diamante" ni "oro" explicito) — Carol lee el contexto
    // real (incluye si esta respondiendo directo a la oferta) en vez de contar palabras
    const aceptaDiamante = await detectUpgradeIntent(history, text, 'MEGA PACK DIAMANTE', 5000);
    if (aceptaDiamante) {
      db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'diamante' });
      await sendAndSave(phone, DIAMANTE_DETAILS);
    } else {
      await sendAndSave(phone, await carol(history, text));
    }
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
  } else if (mentionsOro) {
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
    await sendAndSave(phone, ORO_DETAILS);
  } else if (['no gracias', 'no, gracias', 'no quiero', 'no por ahora', 'asi estoy bien', 'estoy bien asi', 'no me interesa'].some(w => text.includes(w))) {
    // Rechazo CLARO e inequivoco del upsell (frase completa, no solo el token suelto "no") → confirma básico (ya lo eligió antes)
    db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'basico' });
    await sendAndSave(phone, 'Sin problema! Aqui van los datos para tu Pack Basico 📖');
    await sendAndSave(phone, BASICO_DETAILS);
    await sendAndSave(phone, 'Ah, y solo para que lo sepas... el MEGA PACK DIAMANTE tiene un regalo adicional que no te hemos contado todavia 🤫\n\nSi en algun momento quieres saber de que se trata, me preguntas y te cuento 💎');
  } else {
    // Mensaje ambiguo (no dice "oro" ni un rechazo claro) — Carol lee el contexto real
    // en vez de contar palabras, evita perder un "si" claro solo por tener mas de 4 palabras
    const history = db.getRecentMessages(phone, 8);
    const aceptaOro = await detectUpgradeIntent(history, text, 'SUPERPACK ORO', 5000);
    if (aceptaOro) {
      db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'oro' });
      await sendAndSave(phone, ORO_DETAILS);
    } else {
      db.updateContact(phone, { state: 'awaiting_comprobante', pack_selected: 'basico' });
      // Antes Carol respondia sin contexto y la clienta quedaba en Basico aunque preguntara por un
      // curso que solo trae el Oro (caso Juli 573237998457, moldes 3D). Ahora sabe que trae cada pack.
      await sendAndSave(phone, await carol(history, contextoPackElegido('basico') + '\n\n' + text));
    }
  }
}

// Respaldo: busca en el correo de Nequi si el pago realmente llego, antes de escalar a soporte manual.
// Se usa cuando Vision rechaza el comprobante (fecha mal leida o destinatario no verificado)
// pero el pago pudo ser real. Devuelve true si confirmo el pago y ya dejo todo listo (pidio el Gmail).
async function tryEmailFallback(contact, result) {
  const phone = contact.phone;
  const rawMontoFb = result.monto;
  const normalizedMontoFb = rawMontoFb != null
    ? parseInt(String(rawMontoFb).replace(/,\d*$/, '').replace(/\./g, ''), 10) || null
    : null;
  const montoFb = normalizedMontoFb || (contact.pack_selected ? PACK_PRICES[contact.pack_selected] : null);
  if (!montoFb || !GAS_DRIVE_URL) return false;
  try {
    const emailRes = await axios.post(GAS_DRIVE_URL,
      { action: 'checkPayment', monto: montoFb, minutosAtras: 180 },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    if (emailRes.data?.found) {
      const packFb = (normalizedMontoFb ? AMOUNT_TO_PACK[normalizedMontoFb] : null) || contact.pack_selected;
      if (packFb) {
        db.updateContact(phone, { state: 'awaiting_email', pack_selected: packFb, awaiting_email_at: db.now(), email_alert_1: 0, email_alert_2: 0, enlace_acceso_enviado: 0, enlace_fallos: 0, ayuda_correo_avisada: 0 });
        await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);
        await notifyJorge(contact,
          `PAGO VERIFICADO POR EMAIL:\nPack: ${packFb}\nMonto: $${montoFb.toLocaleString('es-CO')}\nTel: ${phone}\nNombre: ${contact.name || '-'}`
        );
        return true;
      }
    }
  } catch (e) {
    console.error('GAS checkPayment error:', e.message);
  }
  return false;
}

async function handleComprobante(contact, mediaContent) {
  const phone = contact.phone;

  let imageBuffer, mimeType, docPages = 0;
  try {
    const parsed = JSON.parse(mediaContent);
    imageBuffer = Buffer.from(parsed.buffer, 'base64');
    mimeType    = parsed.mimeType;
    docPages    = parsed.pages || 0;
  } catch {
    await sendAndSave(phone, 'No pude abrir la imagen. Intentalo de nuevo. 📸');
    return;
  }

  // Descripcion del archivo para las alertas: asi se sabe si llego una foto o un PDF,
  // y de cuantas paginas (un comprobante real siempre es de una sola).
  const esPdf = mimeType === 'application/pdf';
  const archivoInfo = esPdf
    ? `\nArchivo: PDF de ${docPages || '?'} pagina(s), ${Math.round(imageBuffer.length / 1024)} KB`
    : '';

  // Candado: un comprobante real nunca pasa de 1 pagina. Si llega un PDF de varias, es otra cosa
  // (ebook, catalogo, guia) y NO se le pregunta al verificador — ante un documento que no es un
  // comprobante el modelo puede rellenar el JSON copiando el numero y el nombre correctos del
  // propio prompt y responder "valido". Caso real 573247492562 (28 ago 2026): 7 PDF de un curso
  // de cocina ajeno, el septimo fue aprobado como pago sin que la clienta hubiera pagado nada.
  // Si no se pudo contar las paginas (docPages = 0) no se bloquea nada, sigue como siempre.
  if (esPdf && docPages > 2) {
    await sendAndSave(phone, 'Ese archivo no es un comprobante de pago. 📄 Mandame por favor la captura de pantalla del pago (la pantalla donde sale el monto, el numero al que enviaste y la fecha) y lo verifico de una. 📸');
    await notifyJorge(contact,
      `ARCHIVO DESCARTADO (no es comprobante):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || 'sin pack'}${archivoInfo}\nNo se le pidio verificacion al modelo. Revisalo en el panel si crees que si era un pago.`
    );
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

  // Red de seguridad antes de rechazar: ver rescatarComprobanteSinNumero arriba
  rescatarComprobanteSinNumero(result, phone);

  if (!result.valido) {
    const { razon_rechazo, monto } = result;
    if (razon_rechazo === 'no_es_comprobante') {
      if (contact.state === 'new') {
        await sendAndSave(phone, PLANTILLA_ACCESO);
        db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
        await notifyJorge(contact,
          `POSIBLE CLIENTE ANTIGUO (envio imagen que no es comprobante):\nTel: ${phone}\nNombre: ${contact.name || '-'}${archivoInfo}`
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
      await sendAndSave(phone, 'Recibimos tu comprobante! Nuestro equipo esta realizando una verificacion adicional de tu pago. Te confirmamos muy pronto. 🙏');
      db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
      await notifyJorge(contact,
        `ALERTA comprobante sospechoso:\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || 'sin pack'}\nRevisa el comprobante en el panel antes de aprobar.${archivoInfo}`
      );
    } else if (razon_rechazo === 'fecha_incorrecta') {
      const emailConfirmo = await tryEmailFallback(contact, result);
      if (!emailConfirmo) {
        await sendAndSave(phone, PLANTILLA_ACCESO);
        db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
        await notifyJorge(contact,
          `CLIENTE ANTIGUO (comprobante con fecha pasada):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nFecha comprobante: ${result.fecha || 'no detectada'}${archivoInfo}`
        );
      }
    } else if (razon_rechazo === 'destinatario_invalido') {
      const emailConfirmo = await tryEmailFallback(contact, result);
      if (!emailConfirmo) {
        await sendAndSave(phone, 'Recibimos tu comprobante! Nuestro equipo esta realizando una verificacion adicional de tu pago. Te confirmamos muy pronto. 🙏');
        db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
        await notifyJorge(contact,
          `VERIFICACION MANUAL requerida (destinatario no verificado):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || 'sin pack'}\nRevisa el comprobante en el panel.${archivoInfo}`
        );
      }
    } else if (razon_rechazo === 'transaccion_no_exitosa') {
      await sendAndSave(phone, PAYMENT_NOT_SUCCESSFUL);
    } else if (razon_rechazo === 'monto_invalido' || (monto && !AMOUNT_TO_PACK[monto])) {
      const pack = contact.pack_selected || 'basico';
      await sendAndSave(phone, PAYMENT_WRONG_AMOUNT(monto, PACK_PRICES[pack]));
    } else if (razon_rechazo === 'imagen_no_legible') {
      if (contact.pack_selected) {
        // Entregar el pack y notificar a Jorge para verificacion manual
        db.updateContact(phone, { state: 'awaiting_email', awaiting_email_at: db.now(), email_alert_1: 0, email_alert_2: 0, enlace_acceso_enviado: 0, enlace_fallos: 0, ayuda_correo_avisada: 0 });
        await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);
        await notifyJorge(contact,
          `IMAGEN ILEGIBLE - entrega automatica pendiente verificacion:\nPack: ${contact.pack_selected}\nTel: ${phone}\nNombre: ${contact.name || '-'}\nVerifica manualmente que el pago es real antes de que entre el correo.${archivoInfo}`
        );
      } else {
        // Sin pack conocido no se puede entregar — pedir imagen mas clara y avisar a Jorge
        await sendAndSave(phone, 'No pude leer bien tu comprobante. Enviame una foto mas clara donde se vea el monto y el numero al que transferiste. 📸');
        await notifyJorge(contact,
          `IMAGEN ILEGIBLE - sin pack, requiere atencion manual:\nTel: ${phone}\nNombre: ${contact.name || '-'}\nRevisa el comprobante y procesa desde el panel.${archivoInfo}`
        );
      }
    } else {
      await sendAndSave(phone, 'Recibimos tu comprobante! Nuestro equipo esta realizando una verificacion adicional de tu pago. Te confirmamos muy pronto. 🙏');
      db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
      await notifyJorge(contact,
        `VERIFICACION MANUAL requerida (rechazo sin categoria):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || 'sin pack'}\nMotivo: ${razon_rechazo || 'desconocido'}\nRevisa el comprobante en el panel.${archivoInfo}`
      );
    }
    return;
  }

  // Capa de seguridad: verificar destinatario en codigo independientemente del modelo
  const NUMEROS_VALIDOS = ['3058989359', '3217239198'];
  const NOMBRES_VALIDOS  = ['jorge vanegas', 'carol apolinar'];
  // Buscar el numero en cualquier campo del resultado (algunos bancos ponen numero en campo distinto a "destino")
  const allResultText = Object.values(result).filter(v => typeof v === 'string').join(' ').replace(/\D/g, '');
  const destinoOk = NUMEROS_VALIDOS.some(n => allResultText.includes(n));
  const nombreOk  = NOMBRES_VALIDOS.some(n => (result.nombre_destinatario || '').toLowerCase().includes(n));
  if (!destinoOk && !nombreOk) {
    await sendAndSave(phone, PAYMENT_WRONG_RECIPIENT);
    db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
    await notifyJorge(contact,
      `ALERTA: Comprobante destinatario incorrecto (modelo lo aprobo, codigo lo rechazo)\nDestinatario: ${result.destino || 'no detectado'} / ${result.nombre_destinatario || 'no detectado'}\nTel: ${phone}\nNombre: ${contact.name || '-'}${archivoInfo}`
    );
    return;
  }

  // Capa de seguridad: verificar fecha en codigo independientemente del modelo
  // El modelo Haiku puede fallar en rechazar comprobantes de dias anteriores
  if (result.fecha && isFechaAnterior(result.fecha)) {
    await sendAndSave(phone, PLANTILLA_ACCESO);
    db.updateContact(phone, { bot_active: 0, state: 'old_client', tag: 'Soporte' });
    await notifyJorge(contact,
      `CLIENTE ANTIGUO (comprobante con fecha pasada — detectado por codigo):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nFecha comprobante: ${result.fecha}${archivoInfo}`
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

  db.updateContact(phone, { state: 'awaiting_email', pack_selected: pack, awaiting_email_at: db.now(), email_alert_1: 0, email_alert_2: 0, enlace_acceso_enviado: 0, enlace_fallos: 0, ayuda_correo_avisada: 0 });
  await sendAndSave(phone, PAYMENT_RECEIVED_ASK_EMAIL);

  const destino = result.destino || '';
  const paraQuien = destino.includes('3058989359') ? 'Jorge - Nequi/BRE-B' :
                    destino.includes('3217239198') ? 'Carol - Daviplata' :
                    result.nombre_destinatario || 'no identificado';

  await notifyJorge(contact,
    `PAGO verificado!\nPack: ${pack}\nMonto: $${result.monto?.toLocaleString('es-CO') || PACK_PRICES[pack]?.toLocaleString('es-CO')}\nApp: ${result.app || 'desconocida'}\nPago a: ${paraQuien}\nCliente: ${contact.name || phone}\nTel: ${phone}` +
    (result.rescatado ? `\n\nOJO: este entro por la red de seguridad. El lector no logro sacar el numero del destinatario (tirilla de corresponsal o campo con etiqueta rara) y se aprobo por el nombre y el monto. Si puedes, echale un ojo a la imagen en el panel.` : '')
  );
}

async function handleEmail(contact, emailText) {
  const phone = contact.phone;
  const rawText = emailText.trim().toLowerCase();

  // Extraer gmail de texto combinado (ej. "mira el pago\njuanita@gmail.com")
  const gmailMatch = rawText.match(/[\w._%+\-]+@gmail\.com/i);
  const email = gmailMatch ? gmailMatch[0].toLowerCase() : rawText;

  // Typo de duplicacion (ej: "nq8291741gmail.com@gmail.com") — el usuario antes de la @ no deberia contener gmail.com
  if (gmailMatch && email.split('@')[0].includes('gmail.com')) {
    await sendAndSave(phone,
      'Ese correo se ve con un error de escritura. Por favor escribelo de nuevo, solo tu usuario seguido de @gmail.com (ejemplo: tunombre@gmail.com) 📧'
    );
    return;
  }

  if (!gmailMatch) {
    // Cierre/confirmacion — cliente acaba de recibir la solicitud de email, aun no lo da
    const CLOSING_EMAIL = ['listo', 'ok', 'gracias', 'perfecto', 'entendido', 'dale', 'claro'];
    if (CLOSING_EMAIL.some(w => rawText === w)) return; // ignorar silenciosamente

    // 10 sep 2026 se creo el enlace con "Continuar con Google" para quien pago y no da Gmail
    // (casos Paula 573223534427 y Bibiana 573016506566). 14 sep 2026, pedido de Jorge: ese enlace
    // es SOLO para quien dice que no tiene correo, que no quiere darlo, pide que se lo manden por
    // aqui, o escribe "problema". Antes salia con CUALQUIER respuesta sin Gmail y se mando mal 5 de
    // 17 veces: "Mira" y "Porfa valida" escritos junto con el comprobante, "Envio comprobante,
    // muchas gracias", y a Anita 573146673346, que YA habia dado su Gmail y fallo la activacion.
    const historyLarga = db.getRecentMessages(phone, 12);
    const desdePago = contact.awaiting_email_at || '';

    // Ya dio su Gmail y el bot esta reintentando activarle el acceso: no se le pide nada mas.
    if (contact.acceso_pendiente_email) {
      const ctxPendiente = `[CONTEXTO INTERNO: Esta clienta YA PAGÓ y YA DIO su Gmail (${contact.acceso_pendiente_email}). Google se está demorando en activarle el acceso y el sistema lo está reintentando solo: apenas quede, le llega AQUÍ MISMO en este chat el enlace de su carpeta. NO le pidas el correo otra vez, NO le mandes enlaces ni pasos, NO le digas que otra persona del equipo la ayuda. En UN mensaje corto y cálido: su compra está segura y en unos minutos le llega su enlace por este chat. NUNCA digas que algo le llega al correo.]`;
      await sendAndSave(phone, await carol(db.getRecentMessages(phone, 8), ctxPendiente + '\n\nMensaje de la clienta: ' + emailText));
      return;
    }

    // Texto escrito junto con el comprobante ("Mira", "Porfa valida"): llega segundos antes o justo
    // despues del "Pago recibido" que ya le pidio el Gmail. No es una respuesta a ese pedido.
    const aMs = s => new Date(String(s || '').replace(' ', 'T') + 'Z').getTime();
    const ultimoTexto = historyLarga.filter(m => m.direction === 'in' && m.type === 'text').pop();
    if (desdePago && ultimoTexto && aMs(ultimoTexto.created_at) - aMs(desdePago) <= 5000) {
      console.log(`Texto escrito junto con el comprobante, se ignora [${phone}]: ${String(emailText).slice(0, 60)}`);
      return;
    }

    const clsEmail = await clasificarMensajePostPago(historyLarga, emailText);
    if (clsEmail.molesta) await avisarClientaMolesta(contact, emailText, 'pago y no ha dado el correo');

    const yaTieneEnlace = yaTieneEnlaceAcceso(contact, historyLarga);
    const enEstaCompra = m => !desdePago || (m.created_at || '') >= desdePago;
    const yaDioGmail = historyLarga.some(m => m.direction === 'in' && enEstaCompra(m) &&
      typeof m.content === 'string' && /[\w._%+\-]+@gmail\.com/i.test(m.content));
    const dioOtroCorreo = /[\w._%+\-]+@(?!gmail\.com)[a-z0-9\-]+(\.[a-z0-9\-]+)+/i.test(emailText);
    const yaSeLeEnsenoGmail = historyLarga.some(m => m.direction === 'out' && enEstaCompra(m) &&
      typeof m.content === 'string' && m.content.includes('YA tengas un Gmail'));
    if (!yaTieneEnlace && !yaDioGmail) {
      const ultimoBot = historyLarga.filter(m => m.direction === 'out' && typeof m.content === 'string').pop();
      const pideEnlace = /\bproblema/i.test(emailText) || (dioOtroCorreo && yaSeLeEnsenoGmail) ||
        (!dioOtroCorreo && await detectarNoDaCorreo(ultimoBot?.content, emailText));
      if (pideEnlace && await enviarEnlaceSinCorreo(contact)) return;
      // Dio un Hotmail/Outlook por primera vez: primero se le enseña a encontrar el Gmail que ya
      // tiene en el celular. Si vuelve a dar un correo que no es Gmail, ahi si va el enlace.
      if (dioOtroCorreo) {
        await sendAndSave(phone, FIND_GMAIL_MSG);
        return;
      }
    }

    // 10 sep 2026 (tarde), caso Sandra 573134520181: pago, dio un Hotmail, recibio su enlace y
    // escribio "No pude", "No puedo dar mi cuenta de Google", "No sale". Carol le repitio los mismos
    // pasos 3 veces, le dijo "No necesitas Gmail para nada" (falso: sin cuenta de Google la carpeta
    // no abre) y nadie le aviso a Jorge. Ahora: al primer "no pude" Carol hace UNA pregunta (Android
    // o iPhone) sin repetir pasos; con Android le enseña a ver el Gmail que ya tiene en el celular;
    // con iPhone o al segundo "no pude" Carol la sigue ayudando ella misma (desde el 10 sep noche ya
    // no se le avisa a Jorge al celular ni se le dice que otra persona la ayuda: esas clientas
    // aparecen en el filtro Pendientes del panel).
    let fallos = contact.enlace_fallos || 0;
    if (yaTieneEnlace && clsEmail.no_puede_abrir) {
      fallos++;
      db.updateContact(phone, { enlace_fallos: fallos });
    }
    const textoClienta = historyLarga
      .filter(m => m.direction === 'in' && typeof m.content === 'string' && (!desdePago || (m.created_at || '') >= desdePago))
      .map(m => m.content).concat(emailText).join('\n');
    const celular = detectarCelular(textoClienta);
    const escalar = yaTieneEnlace && (fallos >= 2 || celular === 'iphone');
    let guiaEnlace;
    if (!yaTieneEnlace) {
      guiaEnlace = 'Si no sabe cuál es su Gmail y tiene Android, puede verlo en la Play Store tocando su foto arriba a la derecha.\n';
    } else if (escalar) {
      guiaEnlace = 'ESTA CLIENTA YA INTENTÓ ENTRAR CON SU ENLACE Y NO HA PODIDO. Ayúdala TÚ misma: NO le digas que otra persona del equipo la va a ayudar. NO le repitas los pasos del enlace ni del botón de Google. En UN mensaje corto y cálido: tranquilízala (su compra está segura) y hazle UNA pregunta para destrabarla: qué le aparece exactamente en la pantalla cuando toca el enlace, o que te mande una captura. Si tiene iPhone: pregúntale si tiene algún correo que termine en @gmail.com (por ejemplo el que usa en YouTube o en otro celular) y que te lo escriba aquí para activarle el acceso; si no tiene ninguno, como último recurso ofrécele crear uno gratis en gmail.com en 2 minutos y escribírtelo aquí.\n';
    } else if (celular === 'android') {
      guiaEnlace = 'YA SE LE MANDO SU ENLACE y su celular es ANDROID. Un Android siempre tiene un Gmail abierto (sin eso no funciona la Play Store) y NO necesita contraseña para verlo. NO le repitas los pasos del enlace. Explícale corto: "Abre la Play Store, toca tu foto o la letra del círculo arriba a la derecha, y ahí aparece tu correo que termina en @gmail.com". Pídele que te lo escriba aquí y le activas el acceso.\n';
    } else if (clsEmail.no_puede_abrir) {
      guiaEnlace = 'YA SE LE MANDO SU ENLACE y dice que NO PUDO entrar. NO le repitas los pasos del enlace ni del botón de Google. En UN solo mensaje corto: tranquilízala, dile que no tiene que darte ninguna contraseña ni ningún dato, y hazle UNA sola pregunta: si su celular es Android o iPhone.\n';
    } else {
      guiaEnlace = 'YA SE LE MANDO SU ENLACE PERSONAL en este chat. Con ese enlace entra tocando "Continuar con Google" y eligiendo su cuenta, sin escribir ningún correo. NO le vuelvas a pedir el Gmail y NO le repitas pasos que ya le diste. Si ella igual quiere darte su Gmail, perfecto, recíbelo. Si da un correo que no es Gmail (Hotmail, Outlook), explícale con calma que ese no abre la carpeta y recuérdale el enlace.\n';
    }

    // Ya tiene su enlace (o no hay pack para armarlo): responde Carol, sin volver a pedir el Gmail
    const history = db.getRecentMessages(phone, 8);
    // La regla del correo tiene que estar TAMBIEN aqui, no solo en el contexto post-entrega.
    // Caso real 8 sep 2026 (Mary, 573171594370): en este punto exacto Carol improviso "tu carpeta
    // personal con TODO el material llega al Gmail que me des", la clienta se fue a buscarla a su
    // Gmail y termino en la pantalla de redactar un correo. Es el mismo error del 14-15 jul, que se
    // habia corregido solo en ctxDelivered y dejo esta ventana sin cubrir.
    const ctxEmail = '[CONTEXTO INTERNO: Esta clienta YA PAGÓ su pack. NO ofrezcas packs ni preguntes qué pack quiere.\n' +
      'VERDAD QUE NUNCA PUEDES CONTRADECIR: a su correo NO le va a llegar absolutamente nada. El Gmail es solo la LLAVE con la que Google Drive la deja abrir su carpeta. El enlace de la carpeta va por WhatsApp, en este mismo chat.\n' +
      'PROHIBIDO decirle que el material, la carpeta, el acceso o el enlace le llegan al correo o al Gmail. PROHIBIDO mandarla a revisar su bandeja de entrada, su spam o sus promociones.\n' +
      'NUNCA le digas que no necesita Gmail o cuenta de Google: SÍ necesita una cuenta de Google para abrir la carpeta. Lo que NO tiene que hacer es escribir su correo ni ninguna contraseña.\n' +
      guiaEnlace +
      'SI TIENE IPHONE no existe la Play Store: NUNCA le des instrucciones de Play Store ni de Ajustes de Android.\n' +
      'TACTO, OBLIGATORIO: no repitas una instrucción que ya le diste en esta conversación. Nunca le discutas ni le digas "no funciona así". Nunca uses "te lo juro", "te apuesto" ni porcentajes como "el 99%". Mensajes cortos y cálidos.]' +
      (clsEmail.molesta ? NOTA_CLIENTA_MOLESTA : '');
    const reply = await carol(history, ctxEmail + '\n\nMensaje de la clienta: ' + emailText);
    await sendAndSave(phone, reply);
    return;
  }

  const r = await deliverPack(contact, email);
  if (r?.enCurso) await sendAndSave(phone, ACCESO_ACTIVANDO_MSG);
}

// Si Google tarda, se reintenta con el mismo correo a los 30 s, 2, 5, 15 y 30 minutos.
const REINTENTOS_ACCESO_MS = [30e3, 2 * 60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3];
const entregasEnCurso = new Set();
function fechaDentroDe(ms) {
  return new Date(Date.now() + ms).toISOString().replace('T', ' ').substring(0, 19);
}

// Entrega real del pack: da acceso a Drive, manda el enlace por WhatsApp, marca la venta,
// dispara CAPI y Sheets, entrega el regalo si aplica y programa el upsell.
// Extraida de handleEmail (8 sep 2026) para poder reusarla desde la pagina de acceso cuando la
// clienta entra con Google en vez de escribir su correo. NO duplicar esta logica en otro lado:
// ese fue exactamente el origen del bug del mostrario triplicado (ver memoria 10 jul 2026).
// Una sola entrega a la vez por clienta: Anne 573213994224 toco el boton de Google 4 veces seguidas.
async function deliverPack(contact, email, opciones = {}) {
  const phone = contact.phone;
  if (entregasEnCurso.has(phone)) {
    console.log(`Entrega ya en curso [${phone}], se ignora el intento repetido`);
    return { ok: false, enCurso: true };
  }
  entregasEnCurso.add(phone);
  try {
    return await entregarPack(contact, email, opciones);
  } finally {
    entregasEnCurso.delete(phone);
  }
}

async function entregarPack(contact, email, { reintento = false } = {}) {
  const phone = contact.phone;
  const pack = contact.pack_selected || 'basico';

  let driveFolderId = '';
  try {
    const dr = await grantDriveAccess(email, pack);
    driveFolderId = dr.folderId || '';
  } catch (e) {
    console.error('Drive access error:', e.message);
    // 14 sep 2026: antes decia "Hubo un problema al darte acceso. Ya le avise a nuestro equipo" y
    // nadie volvia a intentar: la clienta quedaba pagada y colgada hasta que Jorge la registraba a
    // mano. Sin aviso al celular (suena solo por ventas): lo que no se resuelva queda en Pendientes.
    if (e.espera) {
      const hechos = reintento ? (db.getContact(phone)?.acceso_reintentos || 0) : 0;
      if (hechos < REINTENTOS_ACCESO_MS.length) {
        db.updateContact(phone, {
          acceso_pendiente_email: email,
          acceso_reintentos: hechos + 1,
          acceso_proximo_intento: fechaDentroDe(REINTENTOS_ACCESO_MS[hechos])
        });
        db.logAdminAction(phone, 'acceso_reintento_programado', `email=${email} intento=${hechos + 1} error=${e.message}`);
        if (!reintento) await sendAndSave(phone, ACCESO_ACTIVANDO_MSG);
        return { ok: false, pendiente: true, error: e.message };
      }
      db.updateContact(phone, { acceso_pendiente_email: '', acceso_proximo_intento: '' });
      db.logAdminAction(phone, 'acceso_fallo_definitivo', `email=${email} error=${e.message}`);
      console.error(`Acceso sin activar tras ${hechos} reintentos [${phone}] ${email}: queda en Pendientes`);
      await sendAndSave(phone, ACCESO_DEMORADO_MSG);
      return { ok: false, error: e.message };
    }
    db.updateContact(phone, { acceso_pendiente_email: '', acceso_proximo_intento: '' });
    if (/not found|invalid/i.test(e.message)) {
      // Google dice que ese correo no es una cuenta (caso Lay 573003172873: Gmail mal escrito)
      db.logAdminAction(phone, 'acceso_correo_no_es_google', `email=${email}`);
      await sendAndSave(phone, CORREO_NO_ES_GOOGLE_MSG(email));
    } else {
      db.logAdminAction(phone, 'acceso_error', `email=${email} error=${e.message}`);
      await sendAndSave(phone, ACCESO_DEMORADO_MSG);
    }
    return { ok: false, error: e.message };
  }

  const accessToken = generateAccessToken(phone, pack);
  const accessUrl = `${BOT_URL}/acceso/${accessToken}`;
  // El registro de la venta NO puede depender de que salga el mensaje de WhatsApp. Antes, si el
  // mensaje fallaba (WhatsApp caido, o la clienta entra con Google dias despues, fuera de la
  // ventana de 24h), la clienta ya tenia acceso a Drive pero la venta no se marcaba, no se
  // reportaba a Meta, no quedaba en el Sheet y a Jorge no le llegaba aviso. El 12 jun 2026 se
  // perdieron asi 20 ventas del Sheet. Ahora se registra todo pase lo que pase con el mensaje.
  let mensajeEnviado = true;
  try {
    await sendAndSave(phone, deliveryMessage(pack, accessUrl, email));
  } catch (e) {
    mensajeEnviado = false;
    console.error(`Entrega: no salio el mensaje de WhatsApp [${phone}]:`, e.response?.data ? JSON.stringify(e.response.data) : e.message);
  }
  db.updateContact(phone, { state: 'delivered', tag: 'Facturado', delivered_at: db.now(), email, folder_id: driveFolderId,
    acceso_pendiente_email: '', acceso_reintentos: 0, acceso_proximo_intento: '' });
  const updatedContact = db.getContact(phone);

  if (updatedContact.capi_omitir_proxima) {
    // Entrega que se deshizo con "liberar venta": esta compra ya se le reporto a Meta antes.
    console.log(`CAPI omitido [${phone}]: esta compra ya se reporto a Meta en la entrega anterior`);
    db.updateContact(phone, { capi_omitir_proxima: 0 });
  } else {
    await fireCapi(updatedContact, pack);
  }
  await logSaleToSheets(contact, pack, email);
  await notifyJorge(contact,
    `ENTREGA completada!\nPack: ${pack}\nEmail: ${email}\nTel: ${phone}\nNombre: ${contact.name || '-'}` +
    (mensajeEnviado ? '' : `\n\nOJO: la venta quedo registrada pero NO se le pudo mandar el mensaje de WhatsApp con su enlace. Mandaselo tu (boton "Enlace acceso" del panel).`)
  );

  // Si ya habia elegido su regalo antes de pagar (respondiendo al Bono Relampago de R1), entregarlo
  // de una vez junto con el acceso — no hace falta que vuelva a preguntar por el
  if (mensajeEnviado && pack === 'diamante' && updatedContact.gift_choice && !updatedContact.gift_sent) {
    try {
      const gMsg = GIFT_MSGS[updatedContact.gift_choice];
      const gUrl = GIFT_URLS[updatedContact.gift_choice];
      await sendAndSave(phone, `${gMsg}\n\n${gUrl}\n\nAbrelo con el correo que usaste para el pack. Cualquier cosa me cuentas aqui! 💛`);
      db.updateContact(phone, { gift_sent: 1 });
    } catch (e) { console.error(`Regalo no enviado [${phone}]:`, e.message); }
  }

  // La oferta de subir de pack ya NO sale a los 2 minutos (1 de 113 subio en 20 dias, llegaba
  // antes de que abrieran el material). Ahora el programador pregunta a los 30 min si pudo abrir
  // (CHECK_ACCESO_MSG) y la oferta sale en handlePostDelivery cuando responde que si.

  return { ok: true, folderId: driveFolderId, pack };
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

  // Cliente pide cambiar su correo — escalar a soporte manual (Jorge decide si esta dentro del tiempo permitido: 2h desde la entrega)
  const wantsEmailChange = ['cambiar el correo', 'cambiar correo', 'cambiar mi correo', 'cambiar de correo',
    'cambiar el gmail', 'cambiar mi gmail', 'cambiar de gmail', 'otro correo', 'otro gmail',
    'correo diferente', 'gmail diferente', 'me equivoque de correo', 'puse mal el correo',
    'correo equivocado', 'correo esta mal', 'correo está mal', 'cambio de correo'].some(w => text.includes(w));
  // Si pide cambiar el correo porque su Canva esta con otro, no hace falta cambiar nada: los diseños
  // de Canva abren con cualquier cuenta de Canva. Lo explica Carol (caso 573187506079, 14 sep 2026).
  if (wantsEmailChange && !/canva/i.test(text)) {
    await sendAndSave(phone, 'Claro! Dejame consultar con nuestro equipo para hacer ese cambio con cuidado. En un momento te ayudan por aqui mismo 💛');
    db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
    await notifyJorge(contact,
      `CAMBIO DE CORREO SOLICITADO:\nTel: ${phone}\nNombre: ${contact.name || '-'}\nPack: ${contact.pack_selected || '-'}\nCorreo actual: ${contact.email || '-'}\nEntregado: ${contact.delivered_at || '-'}\nRevisa el tiempo transcurrido antes de hacer el cambio (limite 2 horas).`
    );
    return;
  }

  // 10 sep 2026: la oferta de subir de pack sale cuando responde que SI pudo abrir su material a la
  // pregunta de los 30 min ("Pudiste abrir tu material?"), ya no a los 2 min de la entrega.
  const recentPost = db.getRecentMessages(phone, 6);
  const ultimoBotPost = recentPost.filter(m => m.direction === 'out').pop();
  const respondeCheck = !!contact.check_acceso_sent && !contact.upsell_sent &&
    ['basico', 'oro'].includes(contact.pack_selected) && !!ultimoBotPost &&
    String(ultimoBotPost.content || '').includes('Pudiste abrir tu material');
  const mandarUpsellTrasCheck = async () => {
    await sendAndSave(phone, contact.pack_selected === 'basico' ? UPSELL_BASICO : UPSELL_ORO);
    db.updateContact(phone, { upsell_sent: 1 });
    console.log(`Upsell tras confirmar que abrio [${phone}] pack=${contact.pack_selected}`);
  };
  if (respondeCheck && esAfirmacionCorta(text)) { await mandarUpsellTrasCheck(); return; }

  // Revisor con contexto (10 sep 2026): antes de cualquier otra regla de post-entrega se mira si la
  // clienta dice que no puede abrir su material, o si esta claramente molesta. Solo se salta con
  // cierres de una palabra ("gracias", "ok") para no gastar una consulta en eso.
  const CIERRES_SIMPLES = ['gracias', 'ok', 'listo', 'perfecto', 'de nada', 'dale', 'bien', 'bueno',
    'entendido', 'claro', 'jajaja', 'jaja', '👍', 'si', 'sí', 'amen', 'amén'];
  let notaMolesta = '';
  if (text && !CIERRES_SIMPLES.includes(text)) {
    const clsPost = await clasificarMensajePostPago(db.getRecentMessages(phone, 8), text);
    if (clsPost.molesta) {
      notaMolesta = NOTA_CLIENTA_MOLESTA;
      await avisarClientaMolesta(contact, text, 'ya entregada');
    }
    if (respondeCheck && clsPost.ya_abrio && !clsPost.no_puede_abrir && !clsPost.molesta) {
      await mandarUpsellTrasCheck();
      return;
    }
    if (clsPost.no_puede_abrir) {
      // Caso Alexandra 573244127150: dijo que no podia abrir y Carol le respondio "mira arriba",
      // donde estaba un enlace viejo. Ahora se le manda su enlace de nuevo con los pasos.
      if (!reenviadoHaceMenosDe24h(contact) && await reenviarEnlaceAcceso(contact)) return;
      // Ya se le reenvio hace poco y sigue sin poder: no se le repite, la sigue ayudando Carol.
      // Sin aviso al celular de Jorge (10 sep 2026 noche): el celular suena solo por ventas.
      notaMolesta += NOTA_SIGUE_SIN_PODER_ABRIR;
    }
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
    const recentMsgs = db.getRecentMessages(phone, 8);
    const yaSemilla = recentMsgs.some(m => m.direction === 'out' && m.content.includes('Cuando quieras puedes completarlo al MEGA PACK DIAMANTE'));

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
    // Guarda de longitud: evita que "mañana" o "luego" mencionados dentro de un mensaje largo
    // sobre otro tema (ej: "Mañana empiezo a practicar, gracias!") se lean como aplazamiento
    const isDelaying = text.split(/\s+/).filter(Boolean).length <= 6 &&
      ['después', 'despues', 'luego', 'mas tarde', 'más tarde', 'mañana', 'manana',
      'ahorita', 'pensarlo', 'le aviso', 'aviso', 'otro dia', 'otro día',
      'por el momento', 'por ahora', 'de momento'].some(w => text.includes(w));
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
    // 'quiero' y 'cuanto'/'cuánto' se sacaron de aca por ser demasiado genericas (ej. "eso es
    // lo que quiero que me explique" de una pregunta de soporte, no de una compra) -- 'quiero'
    // ya esta en YES_WORDS, asi que esos casos ambiguos igual caen al chequeo con contexto real
    // (detectUpgradeIntent) mas abajo, en vez de confirmarse aqui a ciegas.
    const explicitWantsUpgrade = ['completar', 'agregar', 'mas cursos',
      'me interesa', 'si quiero', 'sí quiero',
      'comprobante', 'ya pague', 'ya pagué', 'te mando', 'ahi va', 'ahí va',
      'voy a pagar', 'como pago', 'cómo pago', 'datos de pago', 'numero de cuenta',
      'nequi', 'daviplata'].some(w => text.includes(w));
    // Soporte post-venta — detectar antes del rechazo para no confundir "no me llegó" con "no quiero"
    const needsSupport = ['no me llegó', 'no me llego', 'no llegó', 'no llego', 'no recibí', 'no recibi',
      'no tengo acceso', 'no puedo abrir', 'no me aparece', 'no funciona', 'no abre',
      'no me ha llegado', 'no me mandaron', 'no encuentro', 'no me dio'].some(w => text.includes(w));
    if (needsSupport) {
      const history = db.getRecentMessages(phone, 8);
      // Sin este contexto Carol improvisaba y a veces inventaba que se habia mandado un
      // correo (mandaba a revisar spam/promociones) -- NUNCA se envia ningun email, ver
      // caso real 573022497665 (14 jul 2026)
      const ctxNoLlego = '[CONTEXTO INTERNO: El acceso a la carpeta de Drive SOLO se entrega como un enlace en este mismo chat de WhatsApp, ya se le envio antes en esta conversacion. NUNCA se manda ningun correo electronico -- el Gmail que dio es solo la llave para poder abrir esa carpeta, no una direccion donde le llega algo. Si dice que no le llego nada, dile que revise arriba en este mismo chat de WhatsApp (busca el mensaje con el link de Google Drive), NUNCA le digas que revise su bandeja de Gmail, spam o promociones -- ahi nunca va a encontrar nada porque no se envia ningun correo.]';
      await sendAndSave(phone, await carol(history, ctxNoLlego + notaMolesta + '\n\nMensaje de la clienta: ' + text));
      return;
    }
    // Rechazo solo si el mensaje es UNICAMENTE un "no" (ver esSoloRechazo). Antes bastaba un
    // mensaje corto con la palabra "no" y "No lo puedo abrir" se leia como "no gracias".
    const rejectsUpgrade = esSoloRechazo(text) ||
      ['no gracias', 'no quiero', 'no por ahora', 'asi estoy bien', 'estoy bien asi', 'no me interesa'].some(w => text.includes(w));
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
    // El chequeo con contexto real (detectUpgradeIntent) corre SIEMPRE, no solo cuando el mensaje
    // trae una palabra de la lista de "si". Antes estaba detras de hasWord(text, YES_WORDS) y eso
    // dejaba pasar de largo cualquier forma de decir que va a pagar que no usara esas palabras
    // exactas — caso real Karla (573143577059, 18 ago 2026): "Aún puedo transferir los 10.000?"
    // no tiene ninguna palabra de YES_WORDS ni de explicitWantsUpgrade, asi que nunca se marco el
    // upgrade; Carol respondio bien pero el estado quedo sin actualizar, y cuando llego el
    // comprobante 2 minutos despues el bot lo mando a soporte y se apago.
    // A esta altura ya se descartaron soporte, rechazos y despedidas, asi que lo que queda vale
    // la pena consultarlo con contexto. Ver [[feedback_carol_contexto_no_keywords]].
    let wantsUpgrade = explicitWantsUpgrade;
    if (!wantsUpgrade) {
      const packLabelOffer = contact.pack_selected === 'oro' ? 'MEGA PACK DIAMANTE' : 'un pack superior (Oro o Diamante)';
      const montoOffer = contact.pack_selected === 'oro' ? 5000 : null;
      wantsUpgrade = await detectUpgradeIntent(recentMsgs, text, packLabelOffer, montoOffer);
    }
    if (wantsUpgrade) {
      if (contact.pack_selected === 'basico') {
        // Si ya menciona un pack especifico, ir directo
        if (text.includes('diamante') || text === '1') {
          db.updateContact(phone, { upgrade_target: 'diamante', state: 'awaiting_upgrade_comprobante', tag: 'Upgrade', gift_eligible: 1 });
          await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(10000, 'MEGA PACK DIAMANTE'));
        } else if (text.includes('oro') || text === '2') {
          db.updateContact(phone, { upgrade_target: 'oro', state: 'awaiting_upgrade_comprobante', tag: 'Upgrade' });
          await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(5000, 'SUPERPACK ORO'));
        } else {
          await sendAndSave(phone, UPGRADE_CHOICE_BASICO);
        }
        return;
      } else if (contact.pack_selected === 'oro') {
        db.updateContact(phone, { upgrade_target: 'diamante', state: 'awaiting_upgrade_comprobante', tag: 'Upgrade', gift_eligible: 1 });
        await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(5000, 'MEGA PACK DIAMANTE'));
        return;
      }
    }
    // Despues del UPGRADE_CHOICE_BASICO, cliente elige pack
    if (contact.pack_selected === 'basico' && !contact.upgrade_target) {
      if (text.includes('diamante') || text === '1') {
        db.updateContact(phone, { upgrade_target: 'diamante', state: 'awaiting_upgrade_comprobante', tag: 'Upgrade', gift_eligible: 1 });
        await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(10000, 'MEGA PACK DIAMANTE'));
        return;
      }
      if (text.includes('oro') || text === '2') {
        db.updateContact(phone, { upgrade_target: 'oro', state: 'awaiting_upgrade_comprobante', tag: 'Upgrade' });
        await sendAndSave(phone, UPGRADE_PAYMENT_DETAILS(5000, 'SUPERPACK ORO'));
        return;
      }
    }
  }

  // El hook centralizado en processMessage ya resuelve "elige" y "ver_opciones" para clientas
  // elegibles (r1_sent o gift_eligible) antes de llegar aqui. Solo queda el caso de quien YA
  // tiene su regalo y pide explicitamente otro.
  if (contact.pack_selected === 'diamante' && contact.gift_sent) {
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

  const history = db.getRecentMessages(phone, 8);
  const packLabelDelivered = contact.pack_selected === 'diamante' ? 'MEGA PACK DIAMANTE' :
    contact.pack_selected === 'oro' ? 'SUPERPACK ORO' :
    contact.pack_selected === 'basico' ? 'PACK BASICO' : 'su pack';
  const packPriceDelivered = PACK_AMOUNTS[contact.pack_selected];
  const ctxDelivered = `[CONTEXTO INTERNO: Esta clienta YA PAGÓ y YA TIENE ACCESO activo. Pack: ${packLabelDelivered}${packPriceDelivered ? ` ($${packPriceDelivered.toLocaleString('es-CO')})` : ''}. Correo registrado: ${contact.email || 'no registrado'}. Fecha de entrega: ${contact.delivered_at || 'no registrada'}. El acceso a la carpeta de Drive SOLO se entrega como un enlace en este mismo chat de WhatsApp -- NUNCA se manda ningun correo electronico. El Gmail que dio es solo la llave para abrir esa carpeta, no una direccion donde le llega algo. Si dice que no le llego nada o pide que se lo manden al correo, dile que revise arriba en este chat el mensaje con el link de Google Drive -- NUNCA le digas que revise su Gmail, spam o promociones. CANVA: los diseños de Canva del pack abren con CUALQUIER cuenta de Canva, aunque tenga un correo distinto al registrado. El correo registrado (${contact.email || 'el que dio'}) solo sirve para abrir la carpeta de Google Drive. Si su Canva esta con otro correo, NO hace falta cambiar nada: abre la carpeta de Drive con el correo registrado y, cuando toque un diseño de Canva, entra a Canva con la cuenta que ya usa. NUNCA le digas que entre a Drive con el correo de Canva ni con otro correo distinto al registrado. ${detallePackEntregado(contact.pack_selected)} Ayudala con su duda o solicitud actual.]`;
  const reply = await carol(history, ctxDelivered + notaMolesta + '\n\nMensaje de la clienta: ' + text);
  await sendAndSave(phone, reply);
  // Si Carol le conto que puede completar su pack, se anota como oferta hecha: asi, si responde
  // "si quiero", el bloque de upsell le manda los datos correctos del upgrade. Sin esto Carol
  // ofreceria algo que el codigo no sabe (mismo error del caso Karla 573143577059, 18 ago).
  const replyTxt = Array.isArray(reply) ? reply.join(' ') : String(reply || '');
  if (!contact.upsell_sent && ['basico', 'oro'].includes(contact.pack_selected) &&
      /diamante|superpack oro/i.test(replyTxt) && /(?<![\d.])(5|10)\.000/.test(replyTxt)) {
    db.updateContact(phone, { upsell_sent: 1 });
    console.log(`Carol ofrecio completar el pack [${phone}] -> upsell_sent=1`);
  }
}

// Normaliza un monto colombiano: "15.000,00" o "15.000" o 15000 -> 15000
function normalizarMonto(raw) {
  if (raw == null) return null;
  return parseInt(String(raw).replace(/,\d*$/, '').replace(/\./g, ''), 10) || null;
}

// Un comprobante de pago real SIEMPRE es de una sola pagina. Si llega un PDF de varias,
// es otra cosa (ebook, catalogo, guia) y no debe tratarse como pago.
// Devuelve el motivo si hay que rechazarlo, o null si se puede procesar normal.
function pdfNoEsComprobante(parsed) {
  if (!parsed || parsed.mimeType !== 'application/pdf') return null;
  const p = parsed.pages || 0;
  if (p > 2) return `PDF de ${p} paginas`;
  return null;
}

// Revisa una imagen/PDF que llego cuando el cliente YA esta entregado y todavia puede subir de pack,
// pero sin que se haya marcado la intencion por texto. Si es un comprobante cuyo monto calza exacto
// con un diferencial valido, devuelve el pack destino. Si no, devuelve null (va a soporte como antes).
async function inferUpgradeFromPayment(contact, content) {
  const actual = contact.pack_selected;
  if (!actual || actual === 'diamante') return null;

  let parsed, imageBuffer, mimeType;
  try {
    parsed = JSON.parse(content);
    imageBuffer = Buffer.from(parsed.buffer, 'base64');
    mimeType = parsed.mimeType;
  } catch { return null; }

  const motivoPdf = pdfNoEsComprobante(parsed);
  if (motivoPdf) {
    console.log(`Imagen post-entrega descartada como pago [${contact.phone}]: ${motivoPdf}`);
    return null;
  }

  let result;
  try {
    result = await verifyPayment(imageBuffer, mimeType, actual);
  } catch (e) {
    console.error(`inferUpgradeFromPayment verifyPayment error [${contact.phone}]:`, e.message);
    return null;
  }
  if (!result || !result.valido) return null;

  const monto = normalizarMonto(result.monto);
  if (!monto) return null;

  // El pack destino sale del monto pagado + el pack que ya tiene (los diferenciales no se repiten
  // dentro de un mismo pack de origen, asi que no hay ambiguedad)
  const destino = Object.keys(PACK_AMOUNTS).find(
    p => PACK_AMOUNTS[p] - PACK_AMOUNTS[actual] === monto
  );
  return destino || null;
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

    // Mismo criterio que en post-entrega: "no lo puedo abrir" no es cancelar el upgrade
    const isNo = esSoloRechazo(text) || text.includes('no quiero') || text.includes('mejor no');
    const isDelaying = text.split(/\s+/).filter(Boolean).length <= 6 &&
      ['despues', 'después', 'luego', 'mas tarde', 'más tarde',
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

  let imageBuffer, mimeType, parsedUpg;
  try {
    parsedUpg = JSON.parse(content);
    imageBuffer = Buffer.from(parsedUpg.buffer, 'base64');
    mimeType    = parsedUpg.mimeType;
  } catch {
    await sendAndSave(phone, 'No pude abrir la imagen. Intentalo de nuevo. 📸');
    return;
  }

  // Mismo candado que en la verificacion normal: un PDF de varias paginas no es un comprobante
  const motivoPdfUpg = pdfNoEsComprobante(parsedUpg);
  if (motivoPdfUpg) {
    await sendAndSave(phone, 'Ese archivo no es un comprobante de pago. 📄 Mandame por favor la captura de pantalla del pago y lo verifico de una. 📸');
    await notifyJorge(contact,
      `ARCHIVO DESCARTADO en upgrade (no es comprobante):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nArchivo: ${motivoPdfUpg}, ${Math.round(imageBuffer.length / 1024)} KB`
    );
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

  // Red de seguridad antes de rechazar: ver rescatarComprobanteSinNumero arriba
  rescatarComprobanteSinNumero(result, phone);

  if (!result.valido) {
    const { razon_rechazo, monto } = result;
    if (razon_rechazo === 'no_es_comprobante') {
      await sendAndSave(phone, 'Esa imagen no parece ser un comprobante de transferencia bancaria. Si tienes un problema con el contenido o el acceso a tu pack, cuéntame qué pasa y te ayudo. Si es para completar tu upgrade, necesito la captura de tu pago por Nequi, Daviplata u otra app. 📸');
      return;
    } else if (razon_rechazo === 'transaccion_no_exitosa') {
      await sendAndSave(phone, PAYMENT_NOT_SUCCESSFUL);
    } else if (razon_rechazo === 'monto_invalido' || (monto && monto !== diferencial)) {
      await sendAndSave(phone, PAYMENT_WRONG_AMOUNT(monto, diferencial));
    } else {
      await sendAndSave(phone, 'Recibimos tu comprobante! Nuestro equipo esta realizando una verificacion adicional de tu pago. Te confirmamos muy pronto. 🙏');
      db.updateContact(phone, { bot_active: 0, tag: 'Soporte' });
      await notifyJorge(contact,
        `VERIFICACION MANUAL upgrade (${razon_rechazo || 'rechazo'}):\nTel: ${phone}\nNombre: ${contact.name || '-'}\nUpgrade a: ${upgradeTarget}\nRevisa el comprobante en el panel.`
      );
    }
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
    try { await revokeAccess(contact.email, currentPack, contact.folder_id || null); } catch (e) { console.error('Revoke upgrade:', e.message); }
  }
  let upgradeFolderId = '';
  try {
    const dr = await grantDriveAccess(contact.email, upgradeTarget);
    upgradeFolderId = dr.folderId || '';
  } catch (e) {
    console.error('Grant upgrade:', e.message);
    await notifyJorge(contact, `ERROR Drive upgrade:\nDe: ${currentPack}\nA: ${upgradeTarget}\nEmail: ${contact.email}\nError: ${e.message}`);
  }

  const accessToken = generateAccessToken(phone, upgradeTarget);
  const accessUrl   = `${BOT_URL}/acceso/${accessToken}`;
  // Igual que en deliverPack: si el mensaje de WhatsApp falla, el upgrade igual se registra
  let mensajeUpgEnviado = true;
  try {
    await sendAndSave(phone, deliveryMessage(upgradeTarget, accessUrl, contact.email));
  } catch (e) {
    mensajeUpgEnviado = false;
    console.error(`Upgrade: no salio el mensaje de WhatsApp [${phone}]:`, e.response?.data ? JSON.stringify(e.response.data) : e.message);
    await notifyJorge(contact, `OJO: el upgrade a ${upgradeTarget} quedo registrado pero NO se le pudo mandar el mensaje de WhatsApp con su enlace.\nTel: ${phone}\nMandaselo tu (boton "Enlace acceso" del panel).`);
  }

  db.updateContact(phone, { pack_selected: upgradeTarget, upgrade_target: '', state: 'delivered', tag: 'Facturado', folder_id: upgradeFolderId });

  // Si el upgrade fue a Diamante, ofrecer regalo igual que en entrega normal
  // (o entregarlo directo si ya lo habia elegido mientras chateaba antes de que pasaran los 30s)
  if (upgradeTarget === 'diamante') {
    setTimeout(async () => {
      try {
        const fresh = db.getContact(phone);
        if (fresh && fresh.state === 'delivered' && !fresh.gift_sent) {
          if (fresh.gift_choice) {
            const gMsg = GIFT_MSGS[fresh.gift_choice];
            const gUrl = GIFT_URLS[fresh.gift_choice];
            await sendAndSave(phone, `${gMsg}\n\n${gUrl}\n\nAbrelo con el correo que usaste para el pack. Cualquier cosa me cuentas aqui! 💛`);
            db.updateContact(phone, { gift_sent: 1 });
          } else {
            await sendAndSave(phone, GIFT_OFFER_MSG);
          }
        }
      } catch (e) { console.error('Gift upgrade error:', e.message); }
    }, 30 * 1000); // 30 segundos después de la entrega
  }

  // Actualizar fila del sheet: pack nuevo + sumar solo el diferencial (no el precio completo)
  if (GAS_SHEETS_URL) {
    try {
      await axios.post(GAS_SHEETS_URL, {
        action:      'upgrade',
        telefono:    phone,
        pack:        upgradeTarget,
        diferencial: diferencial
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

// Candado final antes de enviar cualquier texto (generado por Carol o plantilla fija).
// No reemplaza las reglas del system prompt de Carol — es la garantia de que, si el modelo
// las olvida, el mensaje que le llega a la clienta de todas formas nunca tiene estas frases.
const BOT_ADMISSION_MSG = `¡Hola! Soy Carol y estoy aquí detrás de la pantalla con toda la energía para ayudarte a emprender. 💖🎨
No te preocupes, estás hablando con la experta. ¡Cuéntame qué necesitas y lo resolvemos ya!`;

const BANNED_PHRASE_REPLACEMENTS = [
  [/\b(te|le)\s+late\b/gi, '$1 parece'],
  [/una pasada/gi, 'una maravilla'],
  [/\bchido\b/gi, 'bacano'],
  [/\b(g|w)uey\b/gi, 'amiga'],
  [/\borale\b/gi, 'dale'],
  [/\bchafa\b/gi, 'malo'],
  [/\bmande\b/gi, 'dime'],
  [/a toda madre/gi, 'buenísimo'],
  [/\bchavo\b/gi, ''],
  [/que padre/gi, 'que bueno'],
  [/no manches/gi, 'en serio'],
  [/\bt[íi]o\b/gi, 'amiga'],
  [/\bt[íi]a\b/gi, 'amiga'],
  [/\bmolar?\b/gi, 'chevere'],
  [/\bguay\b/gi, 'chevere'],
  [/\bhostia\b/gi, ''],
  [/\bjoder\b/gi, ''],
  [/\bcojonudo\b/gi, ''],
  [/\bmazo\b/gi, ''],
  [/\bflipar\b/gi, ''],
  // Frases de vendedor insistente con clientas que ya pagaron (10 sep 2026, Bibiana 573016506566:
  // "te lo juro", "casi el 99% de las personas", "no funciona asi"). Estaban pedidas en el prompt
  // y aun asi aparecieron, por eso se garantizan aqui.
  [/\bte lo juro\b/gi, m => (m[0] === 'T' ? 'De verdad' : 'de verdad')],
  [/\bte juro\b/gi, m => (m[0] === 'T' ? 'De verdad' : 'de verdad')],
  [/\b(casi\s+)?el\s+99\s*%\s+de\s+las\s+personas/gi, 'muchas personas'],
  [/\bpero no funciona as[ií]\b/gi, 'pero funciona de otra forma'],
  // Falso y confuso: sin una cuenta de Google la carpeta NO abre. Lo cierto es que no tiene que
  // ESCRIBIR su correo (10 sep 2026, Sandra 573134520181: "No necesitas Gmail para nada").
  [/\bno necesitas?\s+(un\s+|tu\s+|el\s+|ning[uú]n\s+)?(gmail|correo(\s+de\s+gmail)?|cuenta\s+de\s+google)(?!\s+nuevo)(\s+para\s+nada)?/gi,
    m => (m[0] === 'N' ? 'No tienes que escribirme tu Gmail' : 'no tienes que escribirme tu Gmail')],
  // WhatsApp marca negrita con UN asterisco; con dos (formato de otras apps) se ven los asteriscos
  [/\*\*([^*\n]+)\*\*/g, '*$1*']
];

const AI_ADMISSION_PATTERNS = [
  /soy una ia\b/i, /soy un ia\b/i, /como ia\b/i, /soy un bot\b/i, /soy un robot\b/i,
  /modelo de lenguaje/i, /asistente virtual/i, /inteligencia artificial/i
];

// CANDADO: nunca prometerle a una clienta que el material le llega por correo.
// Nada le llega al correo: el Gmail es solo la llave con la que Drive la deja abrir su carpeta,
// y el enlace se manda por WhatsApp. Esta prohibicion ya estaba en el prompt de Carol desde el
// 14 jul y aun asi volvio a inventarlo el 8 sep (Mary, 573171594370: "tu carpeta personal con
// TODO el material llega al Gmail que me des"), y la clienta se fue a buscarla a su Gmail.
// Leccion ya documentada: una regla lexica simple hay que garantizarla con codigo, no solo
// pidiendosela al modelo. Mismo patron que la admision de ser IA: se reemplaza el mensaje entero.
const FALSE_EMAIL_DELIVERY_PATTERNS = [
  /revisa(r|s)?\s+(tu|el|su)\s+(correo|gmail|bandeja|spam|buz[oó]n)/i,
  /(bandeja de entrada|correo no deseado|carpeta de spam)/i,
  /(llega|llegar[aá]|lleg[oó]|llegan|enviamos|enviaremos|enviad[oa]|mandamos|mandaremos|te\s+lo\s+envi)[^.!?\n]{0,45}\b(al|a\s+tu|a\s+su|en\s+tu|en\s+su)\s+(correo|gmail|bandeja|buz[oó]n)/i,
  /(carpeta|material|acceso|enlace|link|pack|curso)[^.!?\n]{0,60}\b(llega|llegar[aá]|llegan|te\s+llega)[^.!?\n]{0,25}\b(correo|gmail|bandeja)/i
];

const EMAIL_DELIVERY_CORRECTION_MSG = `Ojo con esto, que es importante 📲

Tu material no se manda por correo electronico. El enlace de tu carpeta te lo paso *aqui mismo, en este chat de WhatsApp*.

🔑 Tu Gmail solo sirve como llave para poder abrir la carpeta.

Mira arriba en esta conversacion el mensaje que dice "Tu carpeta personal" y toca ese enlace. Si no lo encuentras o no te abre, escribeme y lo resolvemos ya mismo 💛`;

// Para quien todavia NO tiene su entrega: no se le puede decir "mira arriba el mensaje de tu
// carpeta" porque ese mensaje no existe (Anita 573146673346, 12 sep 2026, se quedo buscandolo).
const EMAIL_DELIVERY_CORRECTION_PENDIENTE_MSG = `Ojo con esto, que es importante 📲

Tu material no se manda por correo electronico. El enlace de tu carpeta te lo paso *aqui mismo, en este chat de WhatsApp*, apenas quede activo tu acceso.

🔑 Tu Gmail solo sirve como llave para poder abrir la carpeta 💛`;

function sanitizeOutboundText(text, estado = '') {
  if (typeof text !== 'string' || !text) return text;

  if (AI_ADMISSION_PATTERNS.some(p => p.test(text))) {
    return BOT_ADMISSION_MSG;
  }

  const patronCorreo = FALSE_EMAIL_DELIVERY_PATTERNS.find(p => p.test(text));
  if (patronCorreo) {
    console.error('BLOQUEADO mensaje que prometia entrega por correo. Texto original: ' +
      JSON.stringify(text.slice(0, 300)));
    return estado === 'delivered' ? EMAIL_DELIVERY_CORRECTION_MSG : EMAIL_DELIVERY_CORRECTION_PENDIENTE_MSG;
  }

  let clean = text.replace(/[—–]/g, ',');
  for (const [pattern, replacement] of BANNED_PHRASE_REPLACEMENTS) {
    clean = clean.replace(pattern, replacement);
  }
  // Limpiar espacios/comas duplicadas que puedan quedar tras remover palabras.
  // OJO: solo espacio/tab, nunca \s genérico — \s también matchea saltos de línea
  // y aplastaba los párrafos de cada mensaje (bug real, ver commit de este fix).
  clean = clean.replace(/,\s*,/g, ',').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?])/g, '$1').trim();
  return clean;
}

// Evita mandar el mismo texto exacto al mismo numero mas de una vez en pocos minutos.
// Caso real (17 jul 2026): una clienta mando 3 dudas distintas en 30 segundos, cada una
// disparaba de nuevo el recordatorio "ya te compartí los testimonios" -- tecnicamente
// cada disparo tenia sentido por separado, pero para la clienta se veia como el bot
// trabado repitiendo lo mismo. Eso puede llevar a que bloqueen o reporten el numero.
const RECENT_SENT_WINDOW_MS = 6 * 60 * 1000; // 6 minutos
const recentSentByPhone = new Map();

function wasRecentlySent(phone, text) {
  const now = Date.now();
  const fresh = (recentSentByPhone.get(phone) || []).filter(e => now - e.ts < RECENT_SENT_WINDOW_MS);
  recentSentByPhone.set(phone, fresh);
  return fresh.some(e => e.text === text);
}

async function sendAndSave(phone, textOrParts) {
  const estado = db.getContact(phone)?.state || '';
  const parts = (Array.isArray(textOrParts) ? textOrParts : [textOrParts]).map(t => sanitizeOutboundText(t, estado));
  for (let i = 0; i < parts.length; i++) {
    if (wasRecentlySent(phone, parts[i])) {
      console.log(`sendAndSave: parte repetida omitida para ${phone} (ya se le mando hace menos de 6 min)`);
      continue;
    }
    const wamid = await sendText(phone, parts[i]);
    db.saveMessage(phone, 'out', 'text', parts[i], wamid);
    const list = recentSentByPhone.get(phone) || [];
    list.push({ text: parts[i], ts: Date.now() });
    recentSentByPhone.set(phone, list);
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 700));
  }
}

// Reintenta activar el acceso de las clientas que ya dieron su Gmail y a las que Google les tardo.
// Lo llama el programador cada 30 segundos, tambien de noche (una clienta pagada no espera al dia).
async function reintentarAccesosPendientes() {
  for (const c of db.getAccesosPendientes()) {
    if (c.state !== 'awaiting_email' || !c.pack_selected) {
      db.updateContact(c.phone, { acceso_pendiente_email: '', acceso_proximo_intento: '' });
      continue;
    }
    // Se vacia la hora antes de intentar para que la siguiente vuelta no lo tome de nuevo
    db.updateContact(c.phone, { acceso_proximo_intento: '' });
    try {
      const r = await deliverPack(c, c.acceso_pendiente_email, { reintento: true });
      if (r?.ok) {
        db.logAdminAction(c.phone, 'acceso_activado_tras_reintento', `email=${c.acceso_pendiente_email}`);
        console.log(`Acceso activado tras reintento [${c.phone}] ${c.acceso_pendiente_email}`);
      } else if (r?.enCurso) {
        db.updateContact(c.phone, { acceso_proximo_intento: fechaDentroDe(30e3) });
      }
    } catch (e) {
      console.error(`Reintento de acceso error [${c.phone}]:`, e.message);
      db.updateContact(c.phone, { acceso_proximo_intento: fechaDentroDe(60e3) });
    }
  }
}

module.exports = { processMessage, sendAndSave, sendGallery, fireCapi, logSaleToSheets, notifyJorge, notifyTelegram, generateAccessToken, handleEmail, deliverPack, reintentarAccesosPendientes };
