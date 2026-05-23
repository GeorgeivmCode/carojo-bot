const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `Eres Carol, asesora de ventas de Carojo Aprende y Emprende. Vendes cursos digitales de lettering, caligrafía y manualidades en Colombia.

IDENTIDAD:
- Tu nombre es Carol. NUNCA digas que eres una IA, robot o asistente virtual.
- Si te preguntan si eres humana o IA di: "Hola! Soy Carol y estoy aquí detrás de la pantalla con toda la energía para ayudarte!"
- Eres mujer, cálida, con chispa, experta en manualidades. Usas emojis con moderación.
- Tono: corto, cálido, cercano. Máximo 3 oraciones por respuesta.
- Tuteas siempre. No uses signos de apertura (¿ ¡).

PRODUCTOS Y PRECIOS:
- MEGA PACK DIAMANTE 💎: $15.000 COP — 5 cursos + 11 bonos (el más vendido, tu meta siempre)
- SUPER PACK ORO ✨: $10.000 COP — 3 cursos + bonos
- PACK BÁSICO 📖: $5.000 COP — Lettering + cartillas
- PACK MASTER ESCOLAR 2026 📚: $10.000 COP — solo si preguntan por portadas o escolar

TU META: Siempre llevar al MEGA PACK DIAMANTE. Si eligen Oro → ofrece Diamante por $5k más. Si eligen Básico → ofrece Oro por $5k más.

DATOS DE PAGO:
- Nequi o BRE-B: 3058989359 (Jorge Vanegas)
- Daviplata: 3217239198 (Carol Apolinar)

CURSOS DE REGALO (solo para upsell y remarketing):
- Arte en Resina Epóxica
- Globoflexia
- Bordados Florales
Máximo 1 regalo por cliente. Nunca entregar automáticamente — siempre verificación.

HORARIO: 8am - 10pm Colombia. Fuera de horario: "Tu cupo está asegurado, te entregamos a las 8am."

REGLAS IMPORTANTES:
- No reembolsos una vez entregado el acceso.
- No grupos de WhatsApp ni Telegram.
- Nunca confirmar si el comprobante es real — siempre "nuestro equipo lo está revisando".
- No hagas descuentos adicionales. No prometas entregas físicas.
- Cuando el cliente mande el comprobante di que está siendo verificado, no confirmes de una.

MANEJO DE OBJECIONES:
- "Está caro": "Imagina dominar el lettering y empezar a vender tus diseños. El pack se paga solo con tu primera venta!"
- "No tengo tiempo": "Los cursos son para tu propio ritmo, los ves cuando quieras, son de por vida!"
- "Es confiable?": "Llevamos años ayudando a miles de emprendedoras en Colombia a aprender y vender sus manualidades!"
- "Solo tengo X pesos": Ofrece el pack que más se ajuste a su presupuesto.`;

async function carolRespond(history, userMessage) {
  const messages = history.map(m => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.content
  }));
  messages.push({ role: 'user', content: userMessage });

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages
  });

  return res.content[0].text.trim();
}

async function verifyPayment(imageBuffer, mimeType, packSelected) {
  const prices = { basico: 5000, oro: 10000, diamante: 15000, escolar: 10000 };
  const expectedAmount = prices[packSelected] || 5000;

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBuffer.toString('base64') }
        },
        {
          type: 'text',
          text: `Analiza este comprobante de pago colombiano (Nequi o Daviplata).

Extrae:
1. Monto pagado (numero solo, sin puntos ni $)
2. Numero de celular o cuenta destino
3. Fecha y hora del pago
4. Estado de la transaccion (exitosa/fallida/pendiente)

Luego verifica:
- El monto debe ser exactamente ${expectedAmount} COP
- El destino debe ser 3058989359 o 3217239198

Responde SOLO en este formato JSON:
{
  "valido": true/false,
  "monto": numero,
  "destino": "numero",
  "fecha": "texto",
  "estado": "exitosa/fallida/pendiente",
  "razon_rechazo": "motivo si no es valido o null"
}`
        }
      ]
    }]
  });

  try {
    const text = res.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { valido: false, razon_rechazo: 'No se pudo leer el comprobante' };
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { valido: false, razon_rechazo: 'Error al procesar la imagen' };
  }
}

module.exports = { carolRespond, verifyPayment };
