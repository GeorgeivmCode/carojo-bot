const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'carojo.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    phone       TEXT PRIMARY KEY,
    name        TEXT DEFAULT '',
    tag         TEXT DEFAULT 'Sin etiqueta',
    bot_active  INTEGER DEFAULT 1,
    ctwa_clid   TEXT DEFAULT '',
    ad_id       TEXT DEFAULT '',
    ad_name     TEXT DEFAULT '',
    state       TEXT DEFAULT 'new',
    pack_selected TEXT DEFAULT '',
    unread_count  INTEGER DEFAULT 0,
    last_message  TEXT DEFAULT '',
    last_message_at TEXT DEFAULT '',
    r1_sent     INTEGER DEFAULT 0,
    r1_sent_at  TEXT DEFAULT '',
    r2_sent     INTEGER DEFAULT 0,
    r2_sent_at  TEXT DEFAULT '',
    created_at  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    phone     TEXT NOT NULL,
    direction TEXT NOT NULL,
    type      TEXT DEFAULT 'text',
    content   TEXT DEFAULT '',
    wamid     TEXT DEFAULT '',
    created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
  CREATE INDEX IF NOT EXISTS idx_contacts_last ON contacts(last_message_at DESC);
`);

function now() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Contacts
function getContact(phone) {
  return db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
}

function createContact(phone, name = '') {
  db.prepare(`
    INSERT OR IGNORE INTO contacts (phone, name) VALUES (?, ?)
  `).run(phone, name);
}

function updateContact(phone, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k]);
  db.prepare(`UPDATE contacts SET ${set} WHERE phone = ?`).run(...values, phone);
}

function getAllContacts() {
  return db.prepare(`
    SELECT * FROM contacts ORDER BY last_message_at DESC
  `).all();
}

function searchContacts(query) {
  const q = `%${query}%`;
  return db.prepare(`
    SELECT * FROM contacts
    WHERE name LIKE ? OR phone LIKE ? OR last_message LIKE ?
    ORDER BY last_message_at DESC
  `).all(q, q, q);
}

function getContactsByTag(tag) {
  return db.prepare(`
    SELECT * FROM contacts WHERE tag = ? ORDER BY last_message_at DESC
  `).all(tag);
}

function getUnreadContacts() {
  return db.prepare(`
    SELECT * FROM contacts WHERE unread_count > 0 ORDER BY last_message_at DESC
  `).all();
}

// Messages
function saveMessage(phone, direction, type, content, wamid = '') {
  db.prepare(`
    INSERT INTO messages (phone, direction, type, content, wamid)
    VALUES (?, ?, ?, ?, ?)
  `).run(phone, direction, type, content, wamid);
}

function getMessages(phone, limit = 50) {
  return db.prepare(`
    SELECT * FROM messages WHERE phone = ? ORDER BY created_at ASC LIMIT ?
  `).all(phone, limit);
}

function getRecentMessages(phone, limit = 10) {
  return db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE phone = ? ORDER BY created_at DESC LIMIT ?
    ) ORDER BY created_at ASC
  `).all(phone, limit);
}

// Remarketing queries
function getContactsForR1() {
  const cutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
  return db.prepare(`
    SELECT * FROM contacts
    WHERE state IN ('awaiting_choice', 'offered_oro', 'offered_basico', 'awaiting_comprobante')
    AND r1_sent = 0
    AND bot_active = 1
    AND last_message_at != ''
    AND last_message_at < ?
  `).all(cutoff);
}

function getContactsForR2() {
  const cutoff = new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
  return db.prepare(`
    SELECT * FROM contacts
    WHERE r1_sent = 1
    AND r2_sent = 0
    AND state NOT IN ('delivered', 'stopped')
    AND bot_active = 1
    AND r1_sent_at != ''
    AND r1_sent_at < ?
  `).all(cutoff);
}

// Stats
function getStats() {
  return {
    total: db.prepare('SELECT COUNT(*) as n FROM contacts').get().n,
    delivered: db.prepare("SELECT COUNT(*) as n FROM contacts WHERE state = 'delivered'").get().n,
    awaiting: db.prepare("SELECT COUNT(*) as n FROM contacts WHERE state = 'awaiting_comprobante'").get().n,
    active: db.prepare("SELECT COUNT(*) as n FROM contacts WHERE bot_active = 1 AND state NOT IN ('delivered','stopped')").get().n,
    today: db.prepare("SELECT COUNT(*) as n FROM contacts WHERE date(created_at) = date('now')").get().n
  };
}

module.exports = {
  getContact, createContact, updateContact, getAllContacts,
  searchContacts, getContactsByTag, getUnreadContacts,
  saveMessage, getMessages, getRecentMessages,
  getContactsForR1, getContactsForR2,
  getStats, now
};
