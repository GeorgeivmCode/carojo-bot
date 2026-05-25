const axios = require('axios');

const GAS_URL = process.env.GAS_URL;

const FOLDER_IDS = {
  basico:   '11REC3PBrfb35NaGpShELpo5X0mekJLuw',
  oro:      '1c41mpvOdASqG3am1uZ5eSQbZuc4gS2LX',
  diamante: '1t3qNyssHh2UqQ9dIIH4dJl1TlkDDatT4'
};

async function grantDriveAccess(email, pack) {
  const folderId = FOLDER_IDS[pack];
  if (!folderId) throw new Error(`Pack desconocido: ${pack}`);
  if (!GAS_URL) throw new Error('GAS_URL no configurada');

  const res = await axios.post(GAS_URL, { email, folderId }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
  });

  if (res.data?.ok === false) {
    throw new Error(`GAS error: ${res.data.error || 'desconocido'}`);
  }

  return res.data;
}

async function revokeAccess(email, pack) {
  const folderId = FOLDER_IDS[pack];
  if (!folderId) throw new Error(`Pack desconocido: ${pack}`);
  if (!GAS_URL) throw new Error('GAS_URL no configurada');

  const res = await axios.post(GAS_URL, { action: 'revoke', email, folderId }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
  });

  if (res.data?.ok === false) {
    throw new Error(`GAS error: ${res.data.error || 'desconocido'}`);
  }

  return res.data;
}

function getFolderUrl(pack) {
  const id = FOLDER_IDS[pack];
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}

module.exports = { grantDriveAccess, revokeAccess, getFolderUrl };
