const WELCOME_MESSAGE = `Hola! Soy Carol de Carojo Aprende y Emprende.

Tenemos 3 packs de lettering y caligrafia para ti:

1️⃣ *Pack Diamante* - $15.000 COP
2️⃣ *Pack Oro* - $10.000 COP
3️⃣ *Pack Basico* - $5.000 COP

Escribe el numero del pack que te interesa y te cuento todo!`;

const DIAMANTE_DETAILS = `*Pack Diamante - $15.000 COP* ✨

Incluye:
• Curso completo de lettering desde cero
• Tecnicas avanzadas de caligrafia
• Plantillas editables profesionales
• Modulo de diseno comercial (para vender tus disenos)
• Soporte directo por 30 dias

Para pagar envia exactamente *$15.000 COP* a:
• Nequi / BRE-B: *3058989359* (Jorge Vanegas)
• Daviplata: *3217239198* (Carol Apolinar)

Luego enviame la foto del comprobante aqui mismo.`;

const ORO_DETAILS = `*Pack Oro - $10.000 COP* 🥇

Incluye:
• Curso completo de lettering desde cero
• Tecnicas avanzadas de caligrafia
• Plantillas editables

Para pagar envia exactamente *$10.000 COP* a:
• Nequi / BRE-B: *3058989359* (Jorge Vanegas)
• Daviplata: *3217239198* (Carol Apolinar)

Luego enviame la foto del comprobante aqui mismo.`;

const ORO_UPSELL = `*Pack Oro - $10.000 COP* 🥇

Incluye:
• Curso completo de lettering desde cero
• Tecnicas avanzadas de caligrafia
• Plantillas editables

Psst... por solo *$5.000 mas* puedes llevarte el *Pack Diamante* que incluye el modulo de diseno comercial y soporte directo. Vale mucho la pena!

Si quieres el Oro, paga *$10.000 COP* a:
• Nequi / BRE-B: *3058989359* (Jorge Vanegas)
• Daviplata: *3217239198* (Carol Apolinar)

O si prefieres el Diamante, paga *$15.000 COP* a los mismos numeros.

Enviame el comprobante cuando hayas pagado!`;

const BASICO_DETAILS = `*Pack Basico - $5.000 COP* ✏️

Incluye:
• Curso completo de lettering desde cero

Para pagar envia exactamente *$5.000 COP* a:
• Nequi / BRE-B: *3058989359* (Jorge Vanegas)
• Daviplata: *3217239198* (Carol Apolinar)

Luego enviame la foto del comprobante aqui mismo.`;

const BASICO_UPSELL = `*Pack Basico - $5.000 COP* ✏️

Incluye:
• Curso completo de lettering desde cero

Una cosita... por solo *$5.000 mas* tienes el *Pack Oro* con tecnicas avanzadas y plantillas. Muchisimo mas completo!

Si quieres el Basico, paga *$5.000 COP* a:
• Nequi / BRE-B: *3058989359* (Jorge Vanegas)
• Daviplata: *3217239198* (Carol Apolinar)

O el Oro por *$10.000 COP* a los mismos numeros.

Enviame el comprobante cuando hayas pagado!`;

const PAYMENT_CONFIRMED_ASK_EMAIL = `Listo! Tu pago fue confirmado. 🎉

Para enviarte el acceso a tu pack necesito tu correo de Gmail.

Escribe tu correo aqui (ejemplo: tunombre@gmail.com)`;

function deliveryMessage(pack, driveUrl) {
  const messages = {
    diamante: `Tu Pack Diamante ya esta listo! 🥂✨

Aqui tienes el acceso a todo tu contenido:
👉 ${driveUrl}

Dentro encontraras:
• Lettering desde cero
• Caligrafia avanzada
• Plantillas editables
• Diseno comercial

Tienes soporte directo por 30 dias. Cualquier duda me escribes aqui mismo.

Que lo disfrutes mucho!`,

    oro: `Tu Pack Oro ya esta listo! 🥇🎉

Aqui tienes el acceso:
👉 ${driveUrl}

Dentro encontraras:
• Lettering desde cero
• Caligrafia avanzada
• Plantillas editables

Cuando quieras puedes ampliar al Diamante por solo $5.000 mas. Avisame!

Que lo disfrutes!`,

    basico: `Tu Pack Basico ya esta listo! ✏️🎉

Aqui tienes el acceso:
👉 ${driveUrl}

Cuando quieras puedes subir al Pack Oro por solo $5.000 mas y tener tecnicas avanzadas y plantillas. Avisame si te interesa!

Que lo disfrutes!`
  };

  return messages[pack] || messages.basico;
}

const R1_MESSAGE = `Hola! Soy Carol de Carojo Aprende y Emprende.

Vi que estabas viendo nuestros packs de lettering pero no terminaste tu compra.

Tenemos un *BONO RELAMPAGO* por las proximas horas: si compras ahora te regalo una guia extra de practica diaria.

Escribe *1* para Diamante, *2* para Oro o *3* para Basico y te ayudo con todo!`;

const R2_MESSAGE = `Hola de nuevo! Carol de Carojo.

Muchos de nuestros estudiantes comenzaron exactamente donde estas tu, sin saber nada de lettering, y hoy venden sus disenos.

El Pack Basico por $5.000 es el punto de entrada perfecto para arrancar hoy.

Si no te interesa escribe *Salir* y no te escribo mas. Pero si quieres intentarlo, escribe el numero del pack y listo!`;

const INVALID_EMAIL_MSG = `Ese correo no parece valido. Necesito un Gmail para enviarte el acceso.

Escribe tu correo completo, por ejemplo: tunombre@gmail.com`;

const PAYMENT_REJECTED_MSG = (razon) =>
  `Hmm, no pude verificar tu pago. ${razon || 'Asegurate de enviar el monto exacto al numero correcto.'}

Intentalo de nuevo o enviame otra foto del comprobante.`;

const PAYMENT_WRONG_AMOUNT = (monto, esperado) =>
  `Vi que el pago es por $${monto?.toLocaleString('es-CO')} pero el pack cuesta $${esperado?.toLocaleString('es-CO')}.

Por favor envia el monto exacto y enviame el comprobante de ese pago.`;

module.exports = {
  WELCOME_MESSAGE,
  DIAMANTE_DETAILS,
  ORO_DETAILS,
  ORO_UPSELL,
  BASICO_DETAILS,
  BASICO_UPSELL,
  PAYMENT_CONFIRMED_ASK_EMAIL,
  deliveryMessage,
  R1_MESSAGE,
  R2_MESSAGE,
  INVALID_EMAIL_MSG,
  PAYMENT_REJECTED_MSG,
  PAYMENT_WRONG_AMOUNT
};
