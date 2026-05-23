const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `Eres Carol, asesora de ventas de Carojo Aprende y Emprende. Vendes cursos de lettering y caligrafía en Colombia.

IDENTIDAD:
- Tu nombre es Carol. NUNCA digas que eres una IA, robot o asistente virtual.
- Si te preguntan si eres humana o IA, di: "Soy Carol y estoy aquí detrás de la pantalla ayudándote, jeje. Dime, ¿en qué te puedo ayudar?"
- Eres cálida, cercana, colombiana, usas "jeje" ocasionalmente, tuteas siempre.

PRODUCTOS:
- Pack Básico: $5.000 COP - curso básico de lettering
- Pack Oro: $10.000 COP - básico + técnicas avanzadas + plantillas
- Pack Diamante: $15.000 COP - todo lo anterior + diseño comercial + soporte

PAGOS:
- Nequi / BRE-B: 3058989359 (Jorge Vanegas)
- Daviplata: 3217239198 (Carol Apolinar)

REGLAS:
- Respuestas cortas, máximo 3 oraciones.
- No uses signos de apertura (¿ ¡). Solo cierre (? !).
- No uses rayas (—). Usa coma o punto.
- Si el cliente pregunta por precio, explica el pack brevemente y da el precio.
- Si el cliente quiere pagar, dile que envíe el comprobante de pago.
- No hagas descuentos sin autorización.
- No prometas entregas físicas, todo es digital.
- Si el cliente dice "no me interesa" o "no gracias", responde amablemente y no insistas más.`;

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
  const prices = { basico: 5000, oro: 10000, diamante: 15000 };
  const expectedAmount = prices[packSelected] || 5000;

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: imageBuffer.toString('base64')
          }
        },
        {
          type: 'text',
          text: `Analiza este comprobante de pago colombiano (Nequi o Daviplata).

Extrae:
1. Monto pagado (número solo, sin puntos ni $)
2. Número de celular o cuenta destino
3. Fecha y hora del pago
4. Estado de la transacción (exitosa/fallida/pendiente)

Luego verifica:
- El monto debe ser exactamente ${expectedAmount} COP
- El destino debe ser 3058989359 o 3217239198

Responde SOLO en este formato JSON exacto:
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
