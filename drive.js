const axios = require('axios');

const GAS_URL = process.env.GAS_URL;

const FOLDER_IDS = {
  basico:   ['11REC3PBrfb35NaGpShELpo5X0mekJLuw'],
  oro:      ['1c41mpvOdASqG3am1uZ5eSQbZuc4gS2LX'],
  diamante: ['1t3qNyssHh2UqQ9dIIH4dJl1TlkDDatT4', '1n7fMnKBzRMLaz71FQoQXaBgDERrAlWX_']
};

async function grantDriveAccess(email, pack) {
  const folders = FOLDER_IDS[pack];
  if (!folders?.length) throw new Error(`Pack desconocido: ${pack}`);
  if (!GAS_URL) throw new Error('GAS_URL no configurada');

  let lastError;
  for (const folderId of folders) {
    try {
      const res = await axios.post(GAS_URL, { email, folderId }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });
      if (res.data?.ok !== false) {
        return { ...res.data, folderId };
      }
      lastError = res.data?.error || 'error desconocido';
      console.warn(`Drive overflow: ${folderId} falló (${lastError}), probando siguiente...`);
    } catch (e) {
      lastError = e.message;
      console.warn(`Drive overflow: ${folderId} excepción (${lastError}), probando siguiente...`);
    }
  }
  throw new Error(`Todos los folders fallaron. Último error: ${lastError}`);
}

async function revokeAccess(email, pack, folderId = null) {
  if (!GAS_URL) throw new Error('GAS_URL no configurada');

  if (folderId) {
    const res = await axios.post(GAS_URL, { action: 'revoke', email, folderId }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });
    if (res.data?.ok === false) throw new Error(`GAS error: ${res.data.error || 'desconocido'}`);
    return res.data;
  }

  const folders = FOLDER_IDS[pack];
  if (!folders?.length) throw new Error(`Pack desconocido: ${pack}`);
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
  const folders = FOLDER_IDS[pack];
  const id = folders?.[0];
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}

module.exports = { grantDriveAccess, revokeAccess, getFolderUrl };
