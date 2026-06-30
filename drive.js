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

async function grantDriveAccess(email, pack) {
  if (!PRIMARY_FOLDER[pack]) throw new Error(`Pack desconocido: ${pack}`);
  if (!GAS_GROUPS_URL) throw new Error('GAS_GROUPS_URL no configurada');

  const res = await axios.post(GAS_GROUPS_URL, { action: 'add', email, pack }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
  });
  if (res.data?.ok === false) throw new Error(`GAS Groups error: ${res.data.error || 'desconocido'}`);
  return { ...res.data, folderId: PRIMARY_FOLDER[pack] };
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

module.exports = { grantDriveAccess, revokeAccess, getFolderUrl };
