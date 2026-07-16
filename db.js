const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'carojo.db');
const db = new Database(DB_PATH);

// WAL mode: lecturas y escrituras en paralelo — mejora dramaticamente el rendimiento
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -8000'); // 8MB cache en memoria

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

// Migrations — safe on existing DBs
try { db.exec(`ALTER TABLE contacts ADD COLUMN gift_sent INTEGER DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN ad_image_url TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN delivered_at TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN upgrade_target TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN upsell_sent INTEGER DEFAULT 0`); } catch (_) {}

try { db.exec(`ALTER TABLE contacts ADD COLUMN email TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN folder_id TEXT DEFAULT ''`); } catch (_) {}

// Curso de regalo: gift_choice guarda cual eligio (aunque lo diga antes de pagar);
// gift_eligible marca si vino de un upgrade a Diamante, unico lugar (ademas de R1) donde se ofrece
try { db.exec(`ALTER TABLE contacts ADD COLUMN gift_choice TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN gift_eligible INTEGER DEFAULT 0`); } catch (_) {}

// Candado para no repetir el envio de testimonios en el mismo chat
try { db.exec(`ALTER TABLE contacts ADD COLUMN testimonios_sent INTEGER DEFAULT 0`); } catch (_) {}

// Candado para no repetir el envio del mostrario en el mismo chat
try { db.exec(`ALTER TABLE contacts ADD COLUMN mostrario_sent INTEGER DEFAULT 0`); } catch (_) {}

// Migracion: status de mensaje (sent/delivered/read/failed)
try { db.exec(`ALTER TABLE messages ADD COLUMN status TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages(wamid)`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN reply_to TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN golden INTEGER DEFAULT 0`); } catch (_) {}

// Settings table for VAPID keys and push subscriptions
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

// Todos los eventos del webhook de Hotmart (compras, cancelaciones, reembolsos, contracargos, etc.)
// No solo PURCHASE_APPROVED — guarda el payload completo para poder auditar cualquier caso despues.
db.exec(`
  CREATE TABLE IF NOT EXISTS hotmart_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event         TEXT NOT NULL,
    transaction_id TEXT DEFAULT '',
    product_id    TEXT DEFAULT '',
    product_name  TEXT DEFAULT '',
    status        TEXT DEFAULT '',
    buyer_name    TEXT DEFAULT '',
    buyer_email   TEXT DEFAULT '',
    amount        REAL,
    currency      TEXT DEFAULT '',
    order_date    TEXT DEFAULT '',
    capi_sent     INTEGER DEFAULT 0,
    raw           TEXT DEFAULT '',
    created_at    TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hotmart_events_tx ON hotmart_events(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_hotmart_events_event ON hotmart_events(event);
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

function getContactsToday() {
  return db.prepare(`
    SELECT * FROM contacts
    WHERE date(last_message_at, '-5 hours') = date('now', '-5 hours')
    ORDER BY last_message_at DESC
  `).all();
}

function getContactsByDate(dateStr) {
  return db.prepare(`
    SELECT DISTINCT c.* FROM contacts c
    INNER JOIN messages m ON m.phone = c.phone
    WHERE date(m.created_at, '-5 hours') = ?
    ORDER BY c.last_message_at DESC
  `).all(dateStr);
}

// Messages
function saveMessage(phone, direction, type, content, wamid = '', reply_to = '') {
  db.prepare(`
    INSERT INTO messages (phone, direction, type, content, wamid, reply_to)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(phone, direction, type, content, wamid, reply_to || '');
}

function getMessages(phone, limit = 50, beforeId = null) {
  if (beforeId) {
    return db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages WHERE phone = ? AND id < ? ORDER BY id DESC LIMIT ?
      ) ORDER BY id ASC
    `).all(phone, beforeId, limit);
  }
  return db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE phone = ? ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC
  `).all(phone, limit);
}

function getMessageByWamid(wamid) {
  return db.prepare('SELECT * FROM messages WHERE wamid = ? LIMIT 1').get(wamid);
}

function updateMessageContent(wamid, content) {
  db.prepare('UPDATE messages SET content = ? WHERE wamid = ?').run(content, wamid);
}

function updateMessageStatus(wamid, status) {
  if (!wamid) return;
  db.prepare(`UPDATE messages SET status = ? WHERE wamid = ? AND direction = 'out'`).run(status, wamid);
}

function getLastInboundWamid(phone) {
  const row = db.prepare(
    `SELECT wamid FROM messages WHERE phone = ? AND direction = 'in' ORDER BY id DESC LIMIT 1`
  ).get(phone);
  return row?.wamid || null;
}

function getRecentMessages(phone, limit = 10) {
  return db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE phone = ? ORDER BY created_at DESC LIMIT ?
    ) ORDER BY created_at ASC
  `).all(phone, limit);
}

// Golden examples
function markGolden(id) {
  db.prepare(`UPDATE messages SET golden = 1 - golden WHERE id = ?`).run(id);
}

function getGoldenExamples(limit = 8) {
  return db.prepare(`
    SELECT m.id, m.content as bot_msg,
      (SELECT content FROM messages
       WHERE phone = m.phone AND direction = 'in' AND id < m.id
       ORDER BY id DESC LIMIT 1) as user_msg
    FROM messages m
    WHERE m.golden = 1 AND m.direction = 'out'
    ORDER BY m.id DESC
    LIMIT ?
  `).all(limit);
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
  // Colombia = UTC-5 (sin horario de verano)
  return {
    total:               db.prepare('SELECT COUNT(*) as n FROM contacts').get().n,
    delivered:           db.prepare("SELECT COUNT(*) as n FROM contacts WHERE state = 'delivered' AND tag != 'Prueba'").get().n,
    awaiting:            db.prepare("SELECT COUNT(*) as n FROM contacts WHERE state = 'awaiting_comprobante'").get().n,
    active:              db.prepare("SELECT COUNT(*) as n FROM contacts WHERE bot_active = 1 AND state NOT IN ('delivered','stopped')").get().n,
    today_conversations: db.prepare("SELECT COUNT(*) as n FROM contacts WHERE date(created_at, '-5 hours') = date('now', '-5 hours')").get().n,
    today_sales:         db.prepare("SELECT COUNT(*) as n FROM contacts WHERE delivered_at != '' AND date(delivered_at, '-5 hours') = date('now', '-5 hours') AND tag != 'Prueba'").get().n
  };
}

// Settings
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

// Hotmart events
function saveHotmartEvent(fields) {
  db.prepare(`
    INSERT INTO hotmart_events
      (event, transaction_id, product_id, product_name, status, buyer_name, buyer_email, amount, currency, order_date, capi_sent, raw)
    VALUES (@event, @transaction_id, @product_id, @product_name, @status, @buyer_name, @buyer_email, @amount, @currency, @order_date, @capi_sent, @raw)
  `).run({
    event: fields.event || '',
    transaction_id: fields.transaction_id || '',
    product_id: fields.product_id != null ? String(fields.product_id) : '',
    product_name: fields.product_name || '',
    status: fields.status || '',
    buyer_name: fields.buyer_name || '',
    buyer_email: fields.buyer_email || '',
    amount: fields.amount != null ? fields.amount : null,
    currency: fields.currency || '',
    order_date: fields.order_date || '',
    capi_sent: fields.capi_sent ? 1 : 0,
    raw: fields.raw || ''
  });
}

function markHotmartEventCapiSent(transaction_id) {
  db.prepare(`UPDATE hotmart_events SET capi_sent = 1 WHERE transaction_id = ?`).run(transaction_id);
}

function getHotmartEvents(limit = 100) {
  return db.prepare(`SELECT * FROM hotmart_events ORDER BY id DESC LIMIT ?`).all(limit);
}

module.exports = {
  getContact, createContact, updateContact, getAllContacts,
  searchContacts, getContactsByTag, getUnreadContacts, getContactsToday, getContactsByDate,
  saveMessage, getMessages, getRecentMessages, getLastInboundWamid, getMessageByWamid, updateMessageContent, updateMessageStatus,
  getContactsForR1, getContactsForR2,
  getStats, getSetting, setSetting, now,
  markGolden, getGoldenExamples,
  saveHotmartEvent, markHotmartEventCapiSent, getHotmartEvents
};
