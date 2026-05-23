const axios = require('axios');

const PHONE_ID = process.env.WA_PHONE_ID;
const TOKEN = process.env.WA_TOKEN;
const BASE = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;

const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
});

async function sendText(to, text) {
  const res = await axios.post(BASE, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text, preview_url: false }
  }, { headers: headers() });
  return res.data?.messages?.[0]?.id || '';
}

async function getMediaUrl(mediaId) {
  const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  return res.data.url;
}

async function downloadMedia(url) {
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    responseType: 'arraybuffer'
  });
  return { buffer: Buffer.from(res.data), mimeType: res.headers['content-type'] || 'image/jpeg' };
}

async function sendImage(to, imageUrl, caption = '') {
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: { link: imageUrl }
  };
  if (caption) body.image.caption = caption;
  const res = await axios.post(BASE, body, { headers: headers() });
  return res.data?.messages?.[0]?.id || '';
}

module.exports = { sendText, sendImage, getMediaUrl, downloadMedia };
