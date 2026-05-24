const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

async function transcribeAudio(audioBuffer, mimeType) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY no configurada');

  const ext = mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('mp4') ? 'mp4'
    : mimeType.includes('mpeg') ? 'mp3'
    : mimeType.includes('webm') ? 'webm'
    : 'ogg';

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
  form.append('model', 'whisper-large-v3');
  form.append('language', 'es');
  form.append('response_format', 'text');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status}: ${err}`);
  }

  return (await res.text()).trim();
}

module.exports = { transcribeAudio };
