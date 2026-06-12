const WELCOME_MESSAGE = [
`✍️ ¡Bienvenida al mundo de la escritura creativa! 🎨

Imagina poder crear frases hermosas, decorar agendas, personalizar libretas o incluso vender tus propios diseños… ¡todo desde cero y con tu propio estilo!

Con nuestros cursos digitales aprenderás paso a paso Lettering, Letra Timoteo y mucho más,
de forma fácil, práctica y muy divertida 💕`,

`✨ Tenemos 3 packs con precio especial para ti:

1️⃣💎 💎 *MEGA PACK DIAMANTE* 💎💎($15.000)
*(5 Cursos + 11 Bonos Premium — el pack más completo para emprender y el más vendido)* ⭐⭐⭐⭐⭐

2️⃣✨ SUPERPACK ORO ($10.000)
(3 Cursos + Bonos — ideal para arrancar tu negocio creativo)

3️⃣📖 PACK BÁSICO ($5.000)
(Curso de Lettering + Cartillas — tu primer paso en el mundo creativo)

👉 Escríbeme el número de tu opción (1, 2 o 3) y te envío todos los detalles al instante 💌`
];

const DIAMANTE_DETAILS = [
`🚀 Excelente eleccion! Esta es, sin duda, la MEJOR opcion.
Es un verdadero arsenal para emprender.

💎✨ 💎✨ 💎✨ 💎✨ 💎✨
💎 MEGA PACK DIAMANTE 💎
💎✨ 💎✨ 💎✨ 💎✨ 💎✨
(Precio Promo: $15.000)

Incluye los 5 CURSOS COMPLETOS:
✔ 1. Curso de Lettering y Letra Timoteo
✔ 2. Curso de Marcado de Cuadernos
✔ 3. Curso de Moldes 3D (Cajas, Flores, Letras)
✔ 4. Pack Papeleria Creativa
✔ 5. Pack Agendas Personalizadas`,

`✨ Y ahora, mira todos los REGALOS que se activan GRATIS ✨

🎁 BONO 1: El Pack de Papeleria Creativa
Mas de 85.000 diseños editables en Canva! Listos para usar en fiestas, eventos y celebraciones.

🎁 BONO 2: Los 6 Regalos Premium Exclusivos
  1. +130 moldes de cajas exclusivas
  2. Flores de papel editables
  3. Kits escolares + etiquetas
  4. Libritos para colorear + cajitas
  5. Invitaciones editables (Canva/PPT)
  6. Pizarras y plantillas creativas

🎁 BONO 3: Bonos del Pack de Agendas
  1. 100 Diseños para Cuadros Fotograficos
  2. 50 Plantillas de Bullet Journal
  3. Guia de Productividad + Intro a PowerPoint

🎁 BONO 4: 500 Dibujos para Colorear!

Es acceso de por vida a todo! 🎉`,

`Para asegurar tu MEGA PACK DIAMANTE, puedes enviar tu pago de $15.000 a nuestras cuentas autorizadas:
🟣 Nequi o BRE-B: 3058989359 (Titular: Jorge Vanegas)
🔴 Daviplata: 3217239198 (Titular: Carol Apolinar)

Quedo atenta a tu comprobante por aqui. 📲🚀`
];

const ORO_UPSELL = [
`Genial! El SUPERPACK ORO es super completo para empezar.
(Precio Promo: $10.000)

Incluye 3 CURSOS COMPLETOS:
✔ 1. Curso de Lettering y Letra Timoteo (con 34 cartillas)
✔ 2. Curso de Marcado de Cuadernos (mas de 300 paginas)
✔ 3. Curso de Moldes de Cajas, Flores y Letras 3D
🎁 BONO: 500 dibujos para colorear.`,

`Es una super eleccion...

🔥 PERO ANTES DE CONFIRMAR... dejame contarte algo rapido.
Justo HOY, por solo $5.000 mas, puedes llevarte el 💎 MEGA PACK DIAMANTE.

Con esa MEJORA, ademas de los 3 cursos que ya elegiste, sumarias:
✔ El Pack de Papeleria Creativa (que son 85.000 diseños en Canva!)
✔ El Pack de Agendas (con sus 3 bonos internos)
✔ Y los 6 REGALOS PREMIUM (cajas, flores, kits escolares, etc.)

Es muchisimo mas contenido por una diferencia minima.
Te gustaria aprovechar y subir al MEGA PACK DIAMANTE por $15.000 en total? 💬`
];

const ORO_DETAILS = `¡Perfecto! Has mejorado tu pedido al SUPERPACK ORO completo. El total a pagar es $10.000. Puedes enviar tu pago a nuestras cuentas autorizadas:
🟣 Nequi o BRE-B: 3058989359 (Titular: Jorge Vanegas)
🔴 Daviplata: 3217239198 (Titular: Carol Apolinar)
Quedo atenta a tu comprobante por aqui. 📲`;

const BASICO_UPSELL = [
`Claro! El PACK BASICO es ideal para empezar solo con Lettering.
(Precio Promo: $5.000)

Incluye:
✔ 1. Curso de Lettering y Letra Timoteo
✔ 34 cartillas con mas de 2.400 paginas
🎁 BONO: 500 dibujos para colorear.`,

`Es perfecto para aprender la tecnica...

🔥 PERO ANTES DE CONFIRMAR... dejame contarte algo rapido.
Justo HOY, por solo $5.000 mas (pagando $10.000 en total), puedes llevarte el ✨ SUPERPACK ORO.

Ademas del curso de Lettering que ya elegiste, sumarias:
✔ El Curso de Marcado de Cuadernos
✔ El Curso de Moldes de Cajas, Flores y Letras 3D

Es el triple de cursos por solo $5.000 mas.

Te animas? 💬`
];

const BASICO_DETAILS = `¡No hay problema! Respetamos tu eleccion. Te quedas con el PACK BASICO. El total a pagar es solo $5.000. Puedes enviar tu pago a nuestras cuentas autorizadas:
🟣 Nequi o BRE-B: 3058989359 (Titular: Jorge Vanegas)
🔴 Daviplata: 3217239198 (Titular: Carol Apolinar)
Quedo atenta a tu comprobante por aqui. 📲`;

const PAYMENT_RECEIVED_ASK_EMAIL = `Listo! 📥 Pago recibido. 🎉

Para activarte el acceso solo necesito tu correo Gmail. El sistema te manda la notificacion directamente ahi — es la forma mas rapida y segura de entregarte el material.

📧 A que *Gmail* te lo enviamos? (debe terminar en @gmail.com) 💌

Escribenos el Gmail que usas a diario — el acceso queda registrado a ese correo. Y si esta lleno no te preocupes, igual te llega todo 😊`;

const DELIVERY_BASICO = `Hola! 🎉✨

Tu Pack Basico de Lettering ya esta listo! 🖊️💛

Aqui tienes tu acceso exclusivo 👇

📂 Tu carpeta personal:
https://drive.google.com/drive/folders/11REC3PBrfb35NaGpShELpo5X0mekJLuw

⚠️ Abrelo con el correo que nos diste. El acceso esta registrado a tu nombre.

Gracias por confiar en nosotros 💛 Este es solo el comienzo de tu historia con el lettering. Disfruta cada trazo y recuerda que aqui siempre estamos para ti!

— Carojo Aprende y Emprende 🌟`;

const DELIVERY_ORO = `Hola! 🎉✨

Tu Pack Oro de Lettering ya esta listo! 🖊️🏅

Aqui tienes tu acceso exclusivo 👇

📂 Tu carpeta personal:
https://drive.google.com/drive/folders/1c41mpvOdASqG3am1uZ5eSQbZuc4gS2LX

⚠️ Abrelo con el correo que nos diste. El acceso esta registrado a tu nombre.

Gracias por confiar en nosotros 💛 Este es solo el comienzo de tu historia con el lettering. Disfruta cada trazo y recuerda que aqui siempre estamos para ti!

— Carojo Aprende y Emprende 🌟`;

const DELIVERY_DIAMANTE = `Hola! 🎉✨

Tu Pack Diamante de Lettering ya esta listo! 🖊️💎

Aqui tienes tu acceso exclusivo 👇

📂 Tu carpeta personal:
https://drive.google.com/drive/folders/1t3qNyssHh2UqQ9dIIH4dJl1TlkDDatT4

⚠️ Abrelo con el correo que nos diste. El acceso esta registrado a tu nombre.

Gracias por confiar en nosotros 💛 Este es solo el comienzo de tu historia con el lettering. Disfruta cada trazo y recuerda que aqui siempre estamos para ti!

— Carojo Aprende y Emprende 🌟`;

const PLANTILLA_ACCESO = `Hola! Ya vimos tu mensaje. 🙏

Nuestro equipo esta revisando tu caso para darte acceso de nuevo.

No tienes que hacer nada mas, nosotras te escribimos muy pronto con la solucion.

Gracias por tu paciencia! 💛`;

const R1_MESSAGE = `Veo que nuestro chat quedo en pausa y no quiero que pierdas tu cupo ni los descuentos de hoy. 🫣

Tienes alguna dudita con los packs que te pueda resolver rapidito?

🚨 *BONO RELAMPAGO* 🚨

Para que te animes a arrancar de una vez, te acabo de habilitar un bono exclusivo. Si confirmas tu pago de $15.000 (💎 *MEGA PACK DIAMANTE*) hoy, te activare un curso completo adicional 100% GRATIS 🎁

Solo tengo habilitados 5 bonos relampago para hoy y se estan agotando rapido.

Elige el que mas te guste:
🌸 Bordados Florales
✨ Resina Epoxica
🎈 Globoflexia y Decoracion

Alcanzas a enviarme el comprobante hoy para separarte el regalo? 👇

_(PD: Si ya no deseas recibir mas info, solo escribeme *Salir* y no te molestare mas 🌸)_`;

const R2_MESSAGE = `Hola 😊 Antes de que se cierre nuestra conversación quería escribirte un segundito.

Sé que a veces uno lo piensa dos veces antes de invertir, ¡y está bien! Pero quería compartirte esto que me escribió una alumna la semana pasada:

💬 *"Compré el MEGA PACK DIAMANTE sin saber nada y en 8 días ya vendí mis primeras libretas personalizadas. Lo que invertí lo recuperé el primer fin de semana"* 💕

Si hay algo que te frenó — una duda, el momento, lo que sea — cuéntame y lo resolvemos. ¿Qué fue lo que te hizo pensarlo? 👇

_(Si ya no quieres más info escríbeme "Salir" 🌸)_`;

const PAYMENT_WRONG_RECIPIENT = `Hmm, el destinatario en tu comprobante no coincide con nuestras cuentas. 🤔

Asegurate de enviar el pago exactamente a:
• Nequi / BRE-B: *3058989359* (Jorge Vanegas)
• Daviplata: *3217239198* (Carol Apolinar)

Una vez lo confirmes, enviame el comprobante aqui. 📸`;

const PAYMENT_NOT_SUCCESSFUL = `Veo que la transaccion no aparece como exitosa. 😕

Verifica que el pago quede *aprobado* en tu app y luego enviame el comprobante. 📸`;

const INVALID_EMAIL_MSG = `El material vive en Google Drive y solo funciona con Gmail para darte acceso 📧

Si no tienes uno puedes crear tu Gmail gratis en gmail.com, tarda menos de 2 minutos. Cuando lo tengas me escribes el correo y te activo el acceso al instante! 💛

tunombre@gmail.com 📩`;

const SEND_COMPROBANTE_MSG = `Para confirmar tu pago necesito ver el comprobante. 📸

Abre tu app (Nequi, Daviplata, Bancolombia, etc.), busca el comprobante de ese pago y enviamelo aqui como imagen o PDF.`;

const GIFT_OFFER_MSG = `Y como te lo prometi, tienes un *CURSO DE REGALO* para elegir! 🎁

Cual de estos tres te llama mas la atencion?

🌸 Bordados Florales
✨ Arte en Resina Epoxica
🎈 Globoflexia y Decoracion

Escribeme el que mas te guste y te mando el acceso de inmediato. 💌`;

const COMPROBANTE_FALSO_MSG = `Ese comprobante no lo puedo verificar. La app que aparece ahi no es reconocida como metodo de pago valido.

Por favor enviame el comprobante desde tu app real: Nequi, Daviplata, Bancolombia, Davivienda, BBVA u otro banco colombiano. 📸`;

const PAYMENT_OLD_DATE_MSG = `Ese comprobante parece ser de un dia anterior y no podemos procesarlo.

Para confirmar tu pago necesito el comprobante de hoy. Abre tu app, busca el pago que hiciste hoy y enviame la captura. 📸`;

const PAYMENT_REJECTED_MSG = (razon) =>
  `Hmm, no pude verificar tu pago. ${razon || 'Asegurate de enviar el monto exacto al numero correcto.'}

Intentalo de nuevo o enviame otra foto del comprobante. 📸`;

const PAYMENT_WRONG_AMOUNT = (monto, esperado) =>
  `Vi que el pago es por $${Number(monto).toLocaleString('es-CO')} pero el pack cuesta $${Number(esperado).toLocaleString('es-CO')}.

Por favor envia el monto exacto y enviame el comprobante de ese pago. 📸`;

const BASE_URL = 'https://carojo-bot.onrender.com/media';

const MOSTRARIO = {
  text: `Mira lo que te llevas! 👀✨

Esto es solo una probadita de todo el contenido que viene dentro de los packs. Imaginate aprender esto desde tu casa, a tu ritmo y de por vida! 🖊️💛

Si quieres arrancar hoy escribe el numero de tu pack:
1️⃣ Diamante $15.000
2️⃣ Oro $10.000
3️⃣ Basico $5.000`,
  images: [`${BASE_URL}/mostrario1.jpeg`, `${BASE_URL}/mostrario2.jpg`]
};

const TESTIMONIOS = {
  text: `Mira lo que dicen nuestras estudiantes! 💬💛

Ellas tambien dudaron al principio... y hoy nos escriben para contarnos sus logros. Tu historia puede ser la proxima! 🌟

Dale una oportunidad a tu lado creativo. Escribe el numero de tu pack:
1️⃣ Diamante $15.000
2️⃣ Oro $10.000
3️⃣ Basico $5.000`,
  images: [`${BASE_URL}/testimonio1.png`, `${BASE_URL}/testimonio2.png`]
};

const MOSTRARIO_TRIGGERS = [
  'muéstrame', 'muestrame', 'quiero ver', 'puedo ver',
  'foto', 'fotos', 'imagen', 'imágenes', 'imagenes',
  'tienes imagen', 'tienes imágenes', 'tienes imagenes',
  'hay imágenes', 'hay imagenes', 'hay fotos',
  'preview', 'muéstralo', 'muestralo',
  'ver el contenido', 'ver los cursos', 'como se ve', 'cómo se ve'
];

const TESTIMONIOS_TRIGGERS = [
  'es confiable', 'es serio', 'es estafa', 'estafa', 'no confio', 'no confío',
  'desconfio', 'desconfío', 'prueba', 'pruebas', 'testimonio', 'testimonios',
  'resultado', 'resultados', 'funciona', 'de verdad', 'en serio',
  'es seguro', 'seguro', 'confianza', 'me da miedo', 'me da desconfianza',
  'engañando', 'engaño', 'engañar', 'me estan engañando', 'me van a engañar',
  'es mentira', 'es verdad', 'me van a robar', 'me roban', 'robo',
  'no creo', 'no me creo', 'dudas', 'no confio', 'sera verdad', 'será verdad',
  'no envian', 'no envían', 'no me envian', 'no me envían', 'no llega', 'no me llega',
  'y si pago', 'si pago', 'pago y no', 'y si no', 'que garantia', 'qué garantía',
  'como se que', 'cómo sé que', 'como sé que', 'me van a dar', 'van a dar',
  'es real', 'es fake', 'no mandan', 'despues de pagar', 'después de pagar'
];

const STOPPED_MSG = `Entendido! 🌸 Acabo de pausar los mensajes para no interrumpirte mas.

Te agradezco mucho por tu tiempo y tu interes en nuestros cursos. Si en algun momento del futuro quieres retomar tu lado creativo, aqui dejaremos las puertas abiertas para ti.

Te deseo un dia hermoso y de mucho exito! 👋✨`;

// Triggers de cliente antiguo (sin acceso)
const OLD_CLIENT_TRIGGERS = [
  'no tengo acceso', 'no puedo entrar', 'perdi el acceso', 'no me llega',
  'no encuentro el link', 'no encuentro el enlace', 'ya compre', 'ya pague',
  'compre antes', 'pague antes', 'me caduco', 'se me caduco', 'no abre',
  'no funciona el link', 'no funciona el enlace',
  'ya no me sale', 'no me aparecen', 'no puedo acceder', 'no me sale el',
  'no me deja entrar', 'perdi el link', 'perdi el enlace',
  'no me carga', 'no carga el', 'soy cliente', 'ya soy alumna',
  'compre hace', 'ya habia comprado', 'ya habia pagado',
  'ya pagué', 'ya compré', 'tuve un problema con el acceso', 'perdi acceso',
  'no me deja el link', 'no me deja bajar', 'no me deja descargar',
  'ya no me deja', 'no puedo descargar', 'no descargue', 'no descargué',
  'ya era clienta', 'ya era cliente',
  'tenia acceso', 'tenía acceso', 'link expiró', 'link expiro', 'link vencio', 'link venció',
  'ya no funciona', 'ya no sirve el link', 'no sirve el link',
  'compre el diamante', 'compré el diamante', 'compre el oro', 'compré el oro',
  'compre el basico', 'compré el basico', 'ya compré antes', 'ya compre antes',
  'habia pagado', 'había pagado', 'ya no tengo acceso', 'perdi mi acceso', 'perdí mi acceso',
  'no me abre', 'se me vencio', 'se me venció', 'archivos que no',
  'ya pagué antes', 'ya pague antes', 'ya lo habia comprado', 'ya lo había comprado',
  'ya habia pagado', 'ya había pagado', 'ya pagué', 'ya compré',
  // variaciones "yo compre/pague" — el cliente dice "yo" en vez de "ya"
  'yo compre', 'yo pagué', 'yo pague', 'yo compré',
  'yo ya compre', 'yo ya pague', 'yo ya compré', 'yo ya pagué',
  // variaciones "no sirven" con links
  'link no sirven', 'links no sirven', 'no sirven los link', 'no sirven los links',
  'el link no sirve', 'los links no sirven', 'no sirve el material',
  // variaciones adicionales frecuentes
  'no puedo abrir', 'no se abre', 'no abre el link', 'no abre el material',
  'compre el mega', 'compré el mega', 'ya soy cliente', 'soy alumna',
  'no me llega nada', 'no me llego', 'no me llegó', 'nunca me llego', 'nunca me llegó',
  'no recibí', 'no recibi', 'no recibi nada', 'no recibí nada',
  'no puedo ver', 'no veo el', 'no aparece el link', 'no aparece nada',
  // orden invertido "hace X compré" — el trigger "compre hace" no hace match
  'hace unos dias compre', 'hace unos días compré', 'hace unos dias compré', 'hace unos días compre',
  'hace tiempo compre', 'hace tiempo compré', 'hace dias compre', 'hace días compré',
  'hace semanas compre', 'hace semanas compré', 'hace meses compre', 'hace meses compré',
  'hace poco compre', 'hace poco compré', 'hace unos meses compre', 'hace unos meses compré',
  // "no me deja acceder" — variante de "no me deja entrar" no cubierta
  'no me deja acceder', 'no me deja ver', 'no me deja abrir',
  'no puedo acceder al', 'ya no puedo acceder',
  // frases de cliente que viene mostrando compra previa
  'esta es la evidencia', 'me lo pasaron', 'me lo enviaron',
  'lo compre el', 'lo compré el'
];

const DRIVE_URLS_FOR_DELIVERY = {
  basico:   'https://drive.google.com/drive/folders/11REC3PBrfb35NaGpShELpo5X0mekJLuw',
  oro:      'https://drive.google.com/drive/folders/1c41mpvOdASqG3am1uZ5eSQbZuc4gS2LX',
  diamante: 'https://drive.google.com/drive/folders/1t3qNyssHh2UqQ9dIIH4dJl1TlkDDatT4'
};

function deliveryMessage(pack, accessUrl) {
  const msgs = { basico: DELIVERY_BASICO, oro: DELIVERY_ORO, diamante: DELIVERY_DIAMANTE };
  let msg = msgs[pack] || DELIVERY_BASICO;
  if (accessUrl) {
    const driveUrl = DRIVE_URLS_FOR_DELIVERY[pack] || DRIVE_URLS_FOR_DELIVERY.basico;
    msg = msg.replace(driveUrl, accessUrl);
  }
  return msg;
}

// ── Upsell post-entrega ───────────────────────────────────────────────────────

const UPSELL_BASICO = `Que bueno que ya tienes tu Pack Basico activo! 🎉

Oye, tengo una preguntita rapida... ¿sabias que puedes agregar mas cursos a lo que ya compraste?

Por $5.000 adicionales completas el *SUPERPACK ORO* y llevas 2 cursos mas.
Por $10.000 adicionales llevas el *MEGA PACK DIAMANTE* completo — 4 cursos mas + 11 bonos + 🎁 un curso extra GRATIS a tu eleccion.

¿Cuál de los dos te llama mas la atencion? Cuentame y lo vemos juntas 💛`;

const UPSELL_ORO = `Que bueno que ya tienes tu SUPERPACK ORO activo! 🎉

Oye, tengo una preguntita rapida... ¿sabias que por $5.000 mas llevas el *MEGA PACK DIAMANTE* completo?

Son 4 cursos adicionales + 11 bonos encima de todo lo que ya tienes. Y como extra especial: 🎁 escoges un curso de regalo GRATIS a tu eleccion.

¿Te llama la atencion completarlo? Cuentame y lo vemos juntas 💛`;

const UPGRADE_CHOICE_BASICO = `Que bueno! Tienes dos opciones:

✨ *SUPERPACK ORO* — $5.000 adicionales (2 cursos mas)
💎 *MEGA PACK DIAMANTE* — $10.000 adicionales (4 cursos mas + 11 bonos + 🎁 un curso de regalo GRATIS)

Cual prefieres? Escribe *ORO* o *DIAMANTE* 😊`;

const UPGRADE_PAYMENT_DETAILS = (monto, packNuevo) =>
`Perfecto! Para completar al ${packNuevo} el valor adicional es *$${Number(monto).toLocaleString('es-CO')}*.

Puedes pagar a las mismas cuentas:
🟣 Nequi o BRE-B: *3058989359* (Jorge Vanegas)
🔴 Daviplata: *3217239198* (Carol Apolinar)

Cuando hagas el pago me mandas el comprobante y te activo el acceso al instante 📲`;

module.exports = {
  WELCOME_MESSAGE,
  DIAMANTE_DETAILS, ORO_DETAILS, ORO_UPSELL,
  BASICO_DETAILS, BASICO_UPSELL,
  PAYMENT_RECEIVED_ASK_EMAIL,
  DELIVERY_BASICO, DELIVERY_ORO, DELIVERY_DIAMANTE,
  PLANTILLA_ACCESO,
  R1_MESSAGE, R2_MESSAGE,
  INVALID_EMAIL_MSG, PAYMENT_REJECTED_MSG, PAYMENT_WRONG_AMOUNT,
  PAYMENT_WRONG_RECIPIENT, PAYMENT_NOT_SUCCESSFUL,
  SEND_COMPROBANTE_MSG, GIFT_OFFER_MSG, COMPROBANTE_FALSO_MSG, PAYMENT_OLD_DATE_MSG,
  STOPPED_MSG, OLD_CLIENT_TRIGGERS,
  MOSTRARIO, TESTIMONIOS, MOSTRARIO_TRIGGERS, TESTIMONIOS_TRIGGERS,
  UPSELL_BASICO, UPSELL_ORO, UPGRADE_CHOICE_BASICO, UPGRADE_PAYMENT_DETAILS,
  deliveryMessage
};
