const axios = require('axios');

const GAS_URL        = process.env.GAS_URL;
const GAS_GROUPS_URL = process.env.GAS_GROUPS_URL;

// Carpeta principal de cada pack (compartida con el grupo)
const PRIMARY_FOLDER = {
  basico:   '11REC3PBrfb35NaGpShELpo5X0mekJLuw',
  oro:      '1c41mpvOdASqG3am1uZ5eSQbZuc4gS2LX',
  diamante: '1n7fMnKBzRMLaz71FQoQXaBgDERrAlWX_'
};

// Todos los folders por pack (para revocar acceso individual de clientes antiguos)
const ALL_FOLDERS = {
  basico:   ['11REC3PBrfb35NaGpShELpo5X0mekJLuw'],
  oro:      ['1c41mpvOdASqG3am1uZ5eSQbZuc4gS2LX'],
  diamante: ['1t3qNyssHh2UqQ9dIIH4dJl1TlkDDatT4', '1n7fMnKBzRMLaz71FQoQXaBgDERrAlWX_']
};

// Carpeta vieja del Diamante: ~600 clientas de antes del sistema de grupos (30 jun 2026) tienen su
// permiso individual ahi y NO estan en el grupo. Si su enlace las manda a la carpeta nueva, Google
// les dice "no tienes acceso" (Diana 573206050781, Isabella 573178497549, 13 y 10 sep 2026).
const DIAMANTE_CARPETA_VIEJA = '1t3qNyssHh2UqQ9dIIH4dJl1TlkDDatT4';
const INICIO_SISTEMA_GRUPOS = '2026-07-01 00:00:00';

// 14 sep 2026: el script de Google que agrega al grupo se "duerme" si pasa rato sin usarse y a veces
// tarda mas de 15 segundos. El bot se rendia aunque Google terminara el trabajo poco despues
// (10 fallos entre el 10 y el 14 sep, ninguno antes). Ahora espera hasta 60 s y reintenta una vez.
const ESPERA_GRUPOS_MS = 60000;

// 18 sep 2026: se sumaron 404, 429 y 500. Apps Script responde 404 cuando el deployment esta
// arrancando o bajo carga, aunque la URL este bien (caso Nath CO.1555902509092616, 17 sep 21:43:
// fallo con 404 y minutos despues el mismo correo entro sin problema). Son pasajeros igual que un
// timeout, asi que merecen el reintento inmediato de 5 segundos en vez de rendirse de una.
function esErrorDeEspera(e) {
  if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET') return true;
  if ([404, 429, 500, 502, 503, 504].includes(e?.response?.status)) return true;
  return /timeout|socket hang up|EAI_AGAIN/i.test(e?.message || '');
}

async function agregarAlGrupo(email, pack) {
  return axios.post(GAS_GROUPS_URL, { action: 'add', email, pack }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: ESPERA_GRUPOS_MS
  });
}

async function grantDriveAccess(email, pack) {
  if (!PRIMARY_FOLDER[pack]) throw new Error(`Pack desconocido: ${pack}`);
  if (!GAS_GROUPS_URL) throw new Error('GAS_GROUPS_URL no configurada');

  let res;
  try {
    res = await agregarAlGrupo(email, pack);
  } catch (e) {
    if (!esErrorDeEspera(e)) throw e;
    console.warn(`GAS Groups lento para ${email} (${e.message}), reintentando una vez`);
    await new Promise(r => setTimeout(r, 5000));
    try {
      res = await agregarAlGrupo(email, pack);
    } catch (e2) {
      if (esErrorDeEspera(e2)) e2.espera = true;
      throw e2;
    }
  }
  // Si el primer intento si alcanzo a agregarla en segundo plano, el segundo puede responder que ya
  // es miembro: eso es exito, no error.
  if (res.data?.ok === false && !/already|exist|duplicate/i.test(String(res.data.error || ''))) {
    throw new Error(`GAS Groups error: ${res.data.error || 'desconocido'}`);
  }
  return { ...res.data, folderId: PRIMARY_FOLDER[pack] };
}

// Consulta liviana para que el script de Google no se duerma. Es un GET: no entra por la parte
// del script que agrega o quita personas, asi que no cambia nada.
async function despertarGrupos() {
  if (!GAS_GROUPS_URL) return;
  try { await axios.get(GAS_GROUPS_URL, { timeout: ESPERA_GRUPOS_MS, maxRedirects: 5 }); } catch (_) {}
}

async function revokeAccess(email, pack, folderId = null) {
  // 1. Remover del grupo (clientes nuevos)
  if (GAS_GROUPS_URL && pack && PRIMARY_FOLDER[pack]) {
    try {
      await axios.post(GAS_GROUPS_URL, { action: 'remove', email, pack }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });
    } catch (e) {
      console.warn('GAS Groups revoke warning:', e.message);
    }
  }

  // 2. Revocar acceso individual Drive (clientes antiguos con folder_id)
  if (!GAS_URL) return { ok: true };

  if (folderId) {
    try {
      const res = await axios.post(GAS_URL, { action: 'revoke', email, folderId }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });
      if (res.data?.ok === false) throw new Error(`GAS error: ${res.data.error || 'desconocido'}`);
    } catch (e) {
      console.warn(`Revoke individual warning folder ${folderId}:`, e.message);
    }
    return { ok: true };
  }

  const folders = ALL_FOLDERS[pack] || [];
  for (const fid of folders) {
    try {
      await axios.post(GAS_URL, { action: 'revoke', email, folderId: fid }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });
    } catch (e) {
      console.warn(`Revoke warning folder ${fid}:`, e.message);
    }
  }
  return { ok: true };
}

function getFolderUrl(pack, folderId = null) {
  if (folderId) return `https://drive.google.com/drive/folders/${folderId}`;
  const id = PRIMARY_FOLDER[pack];
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}

// Carpeta que de verdad puede abrir ESTA clienta. La guardada manda; si no hay y es Diamante
// entregada antes del sistema de grupos, es la carpeta vieja; si no, la carpeta del grupo.
function carpetaDeContacto(contact, pack = null) {
  const p = pack || contact?.pack_selected;
  if (contact?.folder_id) return getFolderUrl(p, contact.folder_id);
  if (p === 'diamante' && contact?.delivered_at && contact.delivered_at < INICIO_SISTEMA_GRUPOS) {
    return getFolderUrl(p, DIAMANTE_CARPETA_VIEJA);
  }
  return getFolderUrl(p);
}

module.exports = { grantDriveAccess, revokeAccess, getFolderUrl, carpetaDeContacto, despertarGrupos, esErrorDeEspera };
