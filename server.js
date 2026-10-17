// Central backend: the POS sends orders here, the server saves them,
// then broadcasts them live to the kitchen display and the admin panel.
import express from 'express';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Server } from 'socket.io';
import { builtInEvents } from './events.js';
import { menuCatalog } from './menu-catalog.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORES = {
  ambiente: { name: 'Café Ambiente', receipt: 'Café Ambiente' },
  rairock: { name: 'RaiRock Seafoods', receipt: 'RaiRock Seafoods' },
};
const storeContext = new AsyncLocalStorage();
const currentStore = () => storeContext.getStore() || 'ambiente';
const storePath = (req, path) => `${req.store === 'rairock' ? '/rairock' : ''}${path}`;
const PORT = Number(process.env.PORT || 3000);
// Sales tax as a fraction, e.g. TAX_RATE=0.12 for 12%. Defaults to no tax.
const TAX_RATE = Number(process.env.TAX_RATE || 0);
// Printed receipts: extra lines under the café name (address, TIN…) and a closing line.
// Separate several lines with |, e.g. RECEIPT_HEADER="123 Rizal St, Manila|TIN 000-000-000-000"
const splitLines = (text) => text.split('|').map((l) => l.trim()).filter(Boolean);
const RECEIPT = {
  name: process.env.RECEIPT_NAME || 'Café Ambiente',
  header: splitLines(process.env.RECEIPT_HEADER || ''),
  footer: splitLines(process.env.RECEIPT_FOOTER || 'Thank you! Please come again.'),
};
const receiptForStore = (station) => currentStore() === 'rairock'
  ? { name: 'RaiRock Seafoods', header: splitLines(process.env.RAIROCK_RECEIPT_HEADER || ''),
      footer: splitLines(process.env.RAIROCK_RECEIPT_FOOTER || 'Thank you! Please come again.'),
      ...(station === 'barista' ? { title: 'Barista' } : {}) }
  : station === 'barista' ? BARISTA_RECEIPT : RECEIPT;
// The barista bar prints its own receipts: own title, numbering (B-0001…) and closing lines.
const BARISTA_RECEIPT = {
  ...RECEIPT,
  title: process.env.BARISTA_RECEIPT_TITLE || 'Coffee Bar',
  header: splitLines(process.env.BARISTA_RECEIPT_HEADER ?? process.env.RECEIPT_HEADER ?? ''),
  footer: splitLines(process.env.BARISTA_RECEIPT_FOOTER || 'Listen for your number at the bar.|Enjoy your coffee!'),
};

// Environment codes bootstrap each screen; owner changes are stored per store.
// BARISTA_PIN and INVENTORY_PIN are optional: without one, that screen opens with Face ID / fingerprint or the owner's login.
const SECRETS = {
  pos: process.env.POS_PIN,
  barista: process.env.BARISTA_PIN,
  inventory: process.env.INVENTORY_PIN,
  kitchen: process.env.KITCHEN_PIN,
  admin: process.env.ADMIN_PASSWORD,
};
const environmentSecretFor = (role) => currentStore() === 'rairock'
  ? process.env[`RAIROCK_${role.toUpperCase()}_${role === 'admin' ? 'PASSWORD' : 'PIN'}`] || SECRETS[role]
  : SECRETS[role];
const pinHashFor = (role) => role === 'admin' ? null : getSetting(`pin_${role}_hash`, null);
const secretFor = (role) => pinHashFor(role) || environmentSecretFor(role);
function matchesSecret(role, value) {
  if (typeof value !== 'string') return false;
  const hash = pinHashFor(role);
  if (!hash) return !!environmentSecretFor(role) && safeEqual(value, environmentSecretFor(role));
  const [scheme, salt, expected] = hash.split(':');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(value, salt, 64).toString('hex');
  return safeEqual(actual, expected);
}
const SESSION_SECRET = process.env.SESSION_SECRET;
const missing = ['POS_PIN', 'KITCHEN_PIN', 'ADMIN_PASSWORD', 'SESSION_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

// ---------- Logins ----------

// How long each device stays logged in. Tablets stay in for a month;
// the owner's login is shorter because it's on a personal phone or laptop.
const SESSION_DAYS = { pos: 30, barista: 30, kitchen: 30, inventory: 30, admin: 7 };

const isRole = (role) => typeof role === 'string' && Object.hasOwn(SECRETS, role);
const can = (role, ...needs) => role === 'admin' || needs.includes(role);

// The two tills. Each keeps its own receipts, numbering and "today" view.
const STATION_OF_ROLE = { pos: 'cashier', barista: 'barista' };
const SELLERS = ['pos', 'barista'];
// The cashier or barista always sells from their own till; the owner says which screen they're on.
const stationOf = (req, asked) => STATION_OF_ROLE[req.role] ?? (asked === 'barista' ? 'barista' : 'cashier');
const receiptLabel = (o) => (o.station === 'barista' ? `B-${String(o.receipt_no).padStart(4, '0')}` : String(o.receipt_no));

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Staff who sign in with their own passkey get a shift-length session, so the next
// cashier has to sign in as themselves.
const STAFF_SESSION_HOURS = 16;

// Session cookie format: "<role>.<expiry ms>.<staff id, 0 for a shared PIN or the owner>.<signature>"
function makeSession(role, staffId = 0) {
  const ms = staffId ? STAFF_SESSION_HOURS * 3_600_000 : SESSION_DAYS[role] * 86_400_000;
  const value = `${role}.${currentStore()}.${Date.now() + ms}.${staffId}`;
  return { token: `${value}.${sign(value)}`, maxAgeSeconds: Math.round(ms / 1000) };
}

// Returns { role, staff } or null. Staff sessions end as soon as the owner removes that person.
function readSession(cookieHeader = '') {
  const cookieName = currentStore() === 'rairock' ? 'session_rairock' : 'session';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const parts = cookie.slice(`${cookieName}=`.length).split('.');
  if (parts.length < 3 || parts.length > 5) return null;
  const [role, second] = parts;
  const modern = Object.hasOwn(STORES, second);
  const store = modern ? second : 'ambiente';
  const expires = modern ? parts[2] : second;
  const signature = parts.at(-1);
  if (!isRole(role) || !signature || !safeEqual(signature, sign(parts.slice(0, -1).join('.')))) return null;
  if (store !== currentStore()) return null;
  if (!(Number(expires) > Date.now())) return null;
  const staffId = modern ? Number(parts[3]) : parts.length === 4 ? Number(parts[2]) : 0;
  if (!staffId) return { role, staff: null };
  const staff = db.prepare('SELECT id, name, role FROM staff WHERE id = ? AND active = 1').get(staffId);
  return staff ? { role, staff } : null;
}

function sessionCookie(req, value, maxAgeSeconds) {
  const cookieName = req.store === 'rairock' ? 'session_rairock' : 'session';
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${req.secure ? '; Secure' : ''}`;
}

function startSession(req, res, role, staffId = 0) {
  const { token, maxAgeSeconds } = makeSession(role, staffId);
  res.setHeader('Set-Cookie', sessionCookie(req, token, maxAgeSeconds));
}

function requireRole(...needs) {
  return (req, res, next) => {
    const session = readSession(req.headers.cookie);
    if (session && can(session.role, ...needs)) {
      req.role = session.role;
      req.staff = session.staff;
      return next();
    }
    res.status(401).json({ error: 'Please log in' });
  };
}

// Slow down PIN guessing: 5 wrong tries for one screen from one address locks it for 5 minutes.
// Counted per screen, so logging in to the POS doesn't reset failed admin attempts.
const loginFailures = new Map(); // "ip|role" -> { count, lockedUntil }


// ---------- Money and dates ----------

const CURRENCY = process.env.CURRENCY || 'PHP';
const moneyFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: CURRENCY });
const money = (cents) => moneyFormat.format(cents / 100);

// Calendar date in the restaurant's time zone (set TZ), as YYYY-MM-DD.
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Start and end of a local day, as UTC ISO strings for querying created_at.
function dayRange(date = localDate()) {
  const [y, m, d] = date.split('-').map(Number);
  return [new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString()];
}


// ---------- Database ----------

// On the cloud host, DATA_DIR points at a persistent volume so sales survive redeploys.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const databases = {
  ambiente: new DatabaseSync(path.join(DATA_DIR, 'data.db')),
  rairock: new DatabaseSync(path.join(DATA_DIR, 'rairock.db')),
};
// Existing queries use the database selected for the current HTTP request.
// Ambiente keeps its original data.db; RaiRock starts in a separate empty file.
const db = new Proxy({}, { get: (_target, property) => {
  const database = databases[currentStore()];
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} });
function initSchema() {
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000; -- wait for a moment instead of failing if the file is briefly locked

  CREATE TABLE IF NOT EXISTS menu_items (
    id               INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    category         TEXT    NOT NULL,
    price_cents      INTEGER NOT NULL,
    sends_to_kitchen INTEGER NOT NULL DEFAULT 1,
    active           INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                 INTEGER PRIMARY KEY,
    client_id          TEXT    NOT NULL UNIQUE,  -- generated by the POS; stops double-submits
    station            TEXT    NOT NULL DEFAULT 'cashier', -- cashier | barista: which till rang it up
    receipt_no         INTEGER NOT NULL,         -- numbered separately per station
    created_at         TEXT    NOT NULL,         -- ISO 8601, UTC
    payment_method     TEXT    NOT NULL,
    subtotal_cents     INTEGER NOT NULL,
    tax_cents          INTEGER NOT NULL,
    total_cents        INTEGER NOT NULL,
    kitchen_status     TEXT    NOT NULL,         -- new | preparing | ready | none | cancelled
    kitchen_started_at TEXT,
    kitchen_ready_at   TEXT,
    UNIQUE (station, receipt_no)
  );

  -- Name and price are copied at the time of sale so old receipts never change.
  CREATE TABLE IF NOT EXISTS order_items (
    id               INTEGER PRIMARY KEY,
    order_id         INTEGER NOT NULL REFERENCES orders(id),
    menu_item_id     INTEGER NOT NULL REFERENCES menu_items(id),
    name             TEXT    NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    qty              INTEGER NOT NULL,
    sends_to_kitchen INTEGER NOT NULL
  );

  -- Everything worth auditing: voids, edits, menu approvals.
  CREATE TABLE IF NOT EXISTS activity_log (
    id            INTEGER PRIMARY KEY,
    at            TEXT    NOT NULL,
    business_date TEXT    NOT NULL,              -- local YYYY-MM-DD
    actor         TEXT    NOT NULL,              -- pos | admin | kitchen
    action        TEXT    NOT NULL,
    order_id      INTEGER,
    message       TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(business_date);
`);

// Columns added after the first version. ALTER keeps existing data.
function addMissingColumns(table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}
addMissingColumns('menu_items', {
  status: "TEXT NOT NULL DEFAULT 'approved'", // pending | approved | rejected
  requested_by: 'TEXT',
  requested_at: 'TEXT',
  reviewed_at: 'TEXT',
  unavailable_since: 'TEXT', // set while staff have marked it unavailable (sold out); NULL = can be sold
});
addMissingColumns('orders', {
  status: "TEXT NOT NULL DEFAULT 'paid'", // paid | voided
  cash_tendered_cents: 'INTEGER',
  change_cents: 'INTEGER',
  void_reason: 'TEXT',
  voided_at: 'TEXT',
  voided_by: 'TEXT',
  edited_at: 'TEXT',
  edit_count: 'INTEGER NOT NULL DEFAULT 0',
  staff_id: 'INTEGER',   // who rang it up, when signed in with their own passkey
  staff_name: 'TEXT',
});
addMissingColumns('activity_log', { actor_name: 'TEXT' });

// Databases from before the barista bar numbered every receipt in one series (receipt_no UNIQUE).
// SQLite can't change a constraint in place, so copy the orders into a table that numbers each
// station separately. Every existing receipt was rung up at the cashier and keeps its number.
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'station')) {
  const columns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE orders_new (
        id                  INTEGER PRIMARY KEY,
        client_id           TEXT    NOT NULL UNIQUE,
        station             TEXT    NOT NULL DEFAULT 'cashier',
        receipt_no          INTEGER NOT NULL,
        created_at          TEXT    NOT NULL,
        payment_method      TEXT    NOT NULL,
        subtotal_cents      INTEGER NOT NULL,
        tax_cents           INTEGER NOT NULL,
        total_cents         INTEGER NOT NULL,
        kitchen_status      TEXT    NOT NULL,
        kitchen_started_at  TEXT,
        kitchen_ready_at    TEXT,
        status              TEXT    NOT NULL DEFAULT 'paid',
        cash_tendered_cents INTEGER,
        change_cents        INTEGER,
        void_reason         TEXT,
        voided_at           TEXT,
        voided_by           TEXT,
        edited_at           TEXT,
        edit_count          INTEGER NOT NULL DEFAULT 0,
        staff_id            INTEGER,
        staff_name          TEXT,
        UNIQUE (station, receipt_no)
      );
      INSERT INTO orders_new (${columns}) SELECT ${columns} FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

db.exec(`
  -- Cashiers and kitchen staff who sign in with their own Face ID, Touch ID or fingerprint.
  CREATE TABLE IF NOT EXISTS staff (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    role       TEXT    NOT NULL,              -- pos | barista | kitchen | inventory
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL
  );

  -- One row per registered device. Only the public key is stored; fingerprints and
  -- faces never leave the device.
  CREATE TABLE IF NOT EXISTS passkeys (
    id           TEXT    PRIMARY KEY,         -- credential id, base64url
    staff_id     INTEGER REFERENCES staff(id),-- NULL for the owner
    role         TEXT    NOT NULL,            -- admin | pos | barista | kitchen
    public_key   BLOB    NOT NULL,
    counter      INTEGER NOT NULL DEFAULT 0,
    transports   TEXT,
    device       TEXT,
    created_at   TEXT    NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- The owner's own events (school days, concerts, a fiesta's exact dates…), shown with the built-in ones.
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    start_date TEXT    NOT NULL,              -- local YYYY-MM-DD
    end_date   TEXT    NOT NULL,
    kind       TEXT    NOT NULL,              -- iligan | national
    note       TEXT,
    created_at TEXT    NOT NULL
  );
`);

db.exec(`
  -- Stock the café keeps: staff update counts from the stock screen, the owner sets reorder levels.
  CREATE TABLE IF NOT EXISTS inventory_items (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    unit       TEXT    NOT NULL,              -- kg, L, pcs, packs…
    quantity   REAL    NOT NULL DEFAULT 0,
    threshold  REAL    NOT NULL DEFAULT 0,    -- below this, it shows on the owner's "to buy" list
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    updated_by TEXT
  );

  -- Every change to a stock level, newest last.
  CREATE TABLE IF NOT EXISTS inventory_log (
    id             INTEGER PRIMARY KEY,
    item_id        INTEGER NOT NULL REFERENCES inventory_items(id),
    at             TEXT    NOT NULL,
    actor          TEXT    NOT NULL,          -- inventory | admin
    actor_name     TEXT,
    kind           TEXT    NOT NULL,          -- added | count | received | used | edited
    change         REAL    NOT NULL,
    quantity_after REAL    NOT NULL,
    note           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_inventory_log_item ON inventory_log(item_id);
`);
}

const getSetting = (key, fallback) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
// The owner's password always works, so the owner can never be locked out.
const pinAllowed = (role) => role === 'admin' || getSetting(`pin_${role}`, '1') === '1';

// Apply the supplied menu once to existing databases. Keep retired rows for old receipts.
function seedMenu() {
const menuVersion = getSetting('menu_catalog_version', '');
if (currentStore() === 'rairock') return; // The owner will add RaiRock's menu when it is supplied.
if (menuVersion !== 'ambiente-2026-10-complete') {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (['ambiente-2026-10', 'ambiente-2026-10-oz'].includes(menuVersion)) {
      // Preserve IDs so carts and unsent offline sales still refer to the same choices.
      const rename = db.prepare("UPDATE menu_items SET name = ? WHERE name = ? AND category = ? AND price_cents = ? AND active = 1 AND status = 'approved'");
      for (const item of menuCatalog) {
        const oldName = item.name.replace('(12oz)', '(Doce)').replace('(16oz)', '(Grande)').replace('(20oz)', '(Venti)');
        if (oldName !== item.name) rename.run(item.name, oldName, item.category, item.priceCents);
      }
      // Extend the existing catalog without replacing IDs, availability, or staff additions.
      const exists = db.prepare('SELECT id FROM menu_items WHERE name = ? AND category = ?');
      const insert = db.prepare('INSERT INTO menu_items (name, category, price_cents, sends_to_kitchen) VALUES (?, ?, ?, ?)');
      for (const item of menuCatalog) {
        if (!exists.get(item.name, item.category)) insert.run(item.name, item.category, item.priceCents, item.sendsToKitchen);
      }
      db.prepare("UPDATE menu_items SET price_cents = 18100 WHERE name = 'Chocolate Cake' AND category = 'Desserts / Cakes / Pastries' AND price_cents = 17300 AND active = 1 AND status = 'approved'").run();
    } else {
      db.prepare("UPDATE menu_items SET active = 0, status = CASE WHEN status = 'pending' THEN 'rejected' ELSE status END WHERE active = 1 OR status = 'pending'").run();
      const insert = db.prepare('INSERT INTO menu_items (name, category, price_cents, sends_to_kitchen) VALUES (?, ?, ?, ?)');
      for (const item of menuCatalog) insert.run(item.name, item.category, item.priceCents, item.sendsToKitchen);
    }
    setSetting('menu_catalog_version', 'ambiente-2026-10-complete');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
}
for (const store of Object.keys(STORES)) storeContext.run(store, () => { initSchema(); seedMenu(); });

function attachItems(orders) {
  if (orders.length === 0) return orders;
  const ids = orders.map((o) => o.id);
  const items = db
    .prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);
  const byOrder = new Map(orders.map((o) => [o.id, { ...o, receipt_label: receiptLabel(o), items: [] }]));
  for (const item of items) byOrder.get(item.order_id).items.push(item);
  return [...byOrder.values()];
}

function loadOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return order ? attachItems([order])[0] : null;
}

// `req` names who did it: the role, plus the staff member's name when they signed in as themselves.
function logActivity(req, action, message, orderId = null) {
  const now = new Date();
  db.prepare(
    'INSERT INTO activity_log (at, business_date, actor, actor_name, action, order_id, message) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(now.toISOString(), localDate(now), req.role, req.staff?.name ?? null, action, orderId, message);
}

// Everything that happened on one local day. Voided receipts are listed but not counted as sales.
// With a station, only that till's receipts (the cashier and barista each see their own).
function dayReport(date = localDate(), station = null) {
  const [from, to] = dayRange(date);
  const only = station ? ' AND station = ?' : '';
  const range = station ? [from, to, station] : [from, to];
  const summary = db
    .prepare(
      `SELECT COALESCE(SUM(status = 'paid'), 0)                                                    AS order_count,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents END), 0)                    AS gross_cents,
              COALESCE(SUM(CASE WHEN status = 'paid' AND payment_method = 'cash' THEN total_cents END), 0) AS cash_cents,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN tax_cents END), 0)                      AS tax_cents,
              COALESCE(SUM(status = 'voided'), 0)                                                 AS void_count,
              COALESCE(SUM(CASE WHEN status = 'voided' THEN total_cents END), 0)                  AS void_cents,
              COALESCE(SUM(edit_count > 0), 0)                                                    AS edited_count
         FROM orders WHERE created_at >= ? AND created_at < ?${only}`
    )
    .get(...range);
  const topItems = db
    .prepare(
      `SELECT MAX(oi.name) AS name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price_cents) AS revenue_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status = 'paid'${station ? ' AND o.station = ?' : ''}
        GROUP BY oi.menu_item_id
        ORDER BY qty DESC, revenue_cents DESC`
    )
    .all(...range);
  const orders = db
    .prepare(`SELECT * FROM orders WHERE created_at >= ? AND created_at < ?${only} ORDER BY created_at DESC, id DESC`)
    .all(...range);
  return { date, isToday: date === localDate(), summary, topItems, orders: attachItems(orders) };
}

// A sale saved on the iPad while offline arrives later but keeps the time it was rung up.
// Anything unbelievable (bad format, in the future, over 2 days old) falls back to now.
function saleTime(createdAt) {
  const now = Date.now();
  const time = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(time) || time > now + 5 * 60_000 || time < now - 2 * 86_400_000) {
    return new Date(now).toISOString();
  }
  return new Date(time).toISOString();
}

// ---------- HTTP + WebSocket ----------

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const storeBroadcast = (roles) => io.to((Array.isArray(roles) ? roles : [roles]).map((role) => `${currentStore()}:${role}`));
const notifyOwnerOverview = () => { if (currentStore() === 'rairock') io.to('ambiente:admin').emit('stores.updated'); };

// Only set TRUST_PROXY when running behind a hosting proxy (it supplies the real client IP and HTTPS).
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// RaiRock's pages and API use /rairock/...; legacy Ambiente addresses remain valid.
app.use((req, res, next) => {
  const isRairock = req.url === '/rairock' || req.url.startsWith('/rairock/');
  req.store = isRairock ? 'rairock' : 'ambiente';
  if (isRairock) req.url = req.url.slice('/rairock'.length) || '/';
  storeContext.run(req.store, next);
});
app.use(express.json());

// Used by the hosting provider to check the app is up.
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/brand', (req, res, next) => express.static(path.join(__dirname, 'client', 'public', req.store === 'rairock' ? 'brands/rairock' : 'brand'))(req, res, next));
app.use('/fonts', express.static(path.join(__dirname, 'client', 'public', 'fonts')));
app.get('/:role.webmanifest', (req, res, next) => {
  const role = req.params.role;
  if (req.store !== 'rairock' || !Object.hasOwn(PAGE, role)) return next();
  const icon = '/rairock/brand/icon-512.png';
  res.type('application/manifest+json').json({
    name: `RaiRock Seafoods ${role.toUpperCase()}`,
    short_name: `RaiRock ${role}`,
    start_url: `/rairock/${role}`,
    scope: '/rairock/',
    display: role === 'kitchen' ? 'fullscreen' : 'standalone',
    orientation: 'landscape',
    background_color: '#F6F2E8',
    theme_color: '#08740C',
    icons: [{ src: icon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  });
});
app.use(express.static(path.join(__dirname, 'dist')));
app.get(['/login', '/login.html'], (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.get('/vendor/webauthn.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js')));

// Stock is updated from its own screen, with its own login.
const STOCK_KEEPERS = ['inventory'];

// The app screens are only served to someone logged in with the right code.
// The barista bar is the POS page; it reads its station from the address.
const PAGE = { pos: 'pos', barista: 'pos', kitchen: 'kitchen', inventory: 'inventory', admin: 'admin' };
for (const [role, page] of Object.entries(PAGE)) {
  app.get(`/${role}`, (req, res) => {
    const current = readSession(req.headers.cookie);
    if (current && can(current.role, role)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
    res.redirect(storePath(req, `/login?role=${role}`));
  });
}

app.post('/api/login', (req, res) => {
  const { role, secret } = req.body ?? {};
  if (!isRole(role)) return res.status(400).json({ error: 'Unknown screen' });
  if (!pinAllowed(role)) return res.status(403).json({ error: 'PIN sign-in is turned off. Use Face ID or fingerprint.' });
  if (!secretFor(role)) return res.status(403).json({ error: 'No PIN is set for this screen. Use Face ID or fingerprint, or ask the owner.' });

  const key = `${req.store}|${req.ip}|${role}`;
  const failure = loginFailures.get(key);
  if (failure?.lockedUntil > Date.now()) {
    const minutes = Math.ceil((failure.lockedUntil - Date.now()) / 60_000);
    return res.status(429).json({ error: `Too many wrong attempts. Try again in ${minutes} min.` });
  }

  if (!matchesSecret(role, secret)) {
    const count = (failure?.count ?? 0) + 1;
    loginFailures.set(key, count >= 5 ? { count: 0, lockedUntil: Date.now() + 5 * 60_000 } : { count });
    return res.status(401).json({ error: role === 'admin' ? 'Wrong password' : 'Wrong PIN' });
  }

  loginFailures.delete(key);
  startSession(req, res, role);
  res.json({ role, home: storePath(req, `/${role}`) });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ ok: true });
});

app.use('/api/menu', requireRole(...SELLERS));
app.use('/api/pos', requireRole(...SELLERS));
app.use('/api/kitchen', requireRole('kitchen'));
app.use('/api/inventory', requireRole(...STOCK_KEEPERS));
app.use('/api/admin', requireRole('admin'));

// ---------- Face ID, Touch ID and fingerprint (passkeys) ----------
// The device checks the face or finger; the server only checks a signature against the
// public key saved when the device was registered. Browsers allow this on HTTPS (or localhost) only.

const ROLE_LABEL = { admin: 'Owner', pos: 'Cashier', barista: 'Barista', kitchen: 'Kitchen', inventory: 'Inventory' };

// Passkeys belong to one web address. RP_ID / RP_ORIGIN override it when needed.
function relyingParty(req) {
  return {
    rpID: process.env.RP_ID || req.hostname,
    origin: process.env.RP_ORIGIN || `${req.protocol}://${req.get('host')}`,
  };
}

// Each sign-in or setup attempt gets a one-time challenge, valid for 5 minutes.
const challenges = new Map(); // id -> { challenge, expires, ...details }
function rememberChallenge(challenge, details = {}) {
  for (const [id, c] of challenges) if (c.expires < Date.now()) challenges.delete(id);
  const id = crypto.randomBytes(16).toString('base64url');
  challenges.set(id, { challenge, expires: Date.now() + 5 * 60_000, store: currentStore(), ...details });
  return id;
}
function takeChallenge(id) {
  const c = challenges.get(id);
  challenges.delete(id);
  return c && c.store === currentStore() && c.expires > Date.now() ? c : null;
}

// Setup codes: the owner makes one for a staff member, who types it on their tablet once.
const setupCodes = new Map(); // code -> { staffId, expires }
function makeSetupCode(staffId) {
  for (const [code, c] of setupCodes) if ((c.store === currentStore() && c.staffId === staffId) || c.expires < Date.now()) setupCodes.delete(code);
  const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
  const expires = Date.now() + 15 * 60_000;
  setupCodes.set(code, { staffId, expires, store: currentStore() });
  return { code, expiresAt: new Date(expires).toISOString() };
}

const transportsOf = (row) => (row.transports ? JSON.parse(row.transports) : undefined);

async function registrationOptions(req, { role, staff }) {
  const name = staff ? staff.name : 'Owner';
  const existing = db.prepare('SELECT id, transports FROM passkeys WHERE role = ? AND staff_id IS ?').all(role, staff?.id ?? null);
  const options = await generateRegistrationOptions({
    rpName: STORES[currentStore()].name,
    rpID: relyingParty(req).rpID,
    userName: `${name} (${ROLE_LABEL[role]})`,
    userDisplayName: name,
    userID: new TextEncoder().encode(staff ? `staff-${staff.id}` : 'owner'),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: transportsOf(p) })), // same device twice
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { options, challengeId: rememberChallenge(options.challenge, { purpose: 'register', role, staffId: staff?.id ?? null }) };
}

// Which sign-in methods the login page should offer for a screen.
app.get('/api/login-options', (req, res) => {
  const role = isRole(req.query.role) ? req.query.role : 'admin';
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM passkeys p LEFT JOIN staff s ON s.id = p.staff_id
        WHERE (p.role = ? OR p.role = 'admin') AND (p.staff_id IS NULL OR s.active = 1)`
    )
    .get(role);
  res.json({ pin: pinAllowed(role) && !!secretFor(role), passkeys: n > 0 });
});

// Who is signed in on this device.
app.get('/api/me', (req, res) => {
  const session = readSession(req.headers.cookie);
  const requestedRole = req.query.role;
  res.setHeader('Cache-Control', 'no-store');
  if (!session || (requestedRole && (!isRole(requestedRole) || !can(session.role, requestedRole)))) {
    return res.status(401).json({ error: 'Please log in' });
  }
  res.json({ role: session.role, name: session.staff?.name ?? null });
});

// Staff, step 1: the setup code from the owner starts registering this device.
app.post('/api/passkeys/setup', async (req, res) => {
  const key = `${req.store}|${req.ip}|setup`;
  const failure = loginFailures.get(key);
  if (failure?.lockedUntil > Date.now()) return res.status(429).json({ error: 'Too many wrong codes. Try again in a few minutes.' });

  const entry = setupCodes.get(String(req.body?.code ?? '').replace(/\D/g, ''));
  const staff = entry && entry.store === req.store && entry.expires > Date.now()
    ? db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(entry.staffId)
    : null;
  if (!staff) {
    const count = (failure?.count ?? 0) + 1;
    loginFailures.set(key, count >= 5 ? { count: 0, lockedUntil: Date.now() + 5 * 60_000 } : { count });
    return res.status(400).json({ error: 'That code is wrong or has expired. Ask the owner for a new one.' });
  }
  loginFailures.delete(key);
  const { options, challengeId } = await registrationOptions(req, { role: staff.role, staff });
  challenges.get(challengeId).code = String(req.body.code).replace(/\D/g, '');
  res.json({ options, challengeId, name: staff.name });
});

// Owner, step 1: add Face ID / Touch ID on the device the owner is using now.
app.post('/api/admin/passkeys/options', requireRole('admin'), async (req, res) => {
  res.json(await registrationOptions(req, { role: 'admin', staff: null }));
});

// Step 2 for both: save the new passkey. Staff are signed in straight away.
app.post('/api/passkeys/register', async (req, res) => {
  const c = takeChallenge(req.body?.challengeId);
  if (!c || c.purpose !== 'register') return res.status(400).json({ error: 'Setup timed out. Start again.' });
  if (c.role === 'admin' && readSession(req.headers.cookie)?.role !== 'admin') return res.status(401).json({ error: 'Please log in' });
  if (c.staffId && setupCodes.get(c.code)?.store !== req.store) return res.status(400).json({ error: 'That code was already used or has expired.' });

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: c.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not set up: ${err.message}` });
  }
  if (!verification.verified) return res.status(400).json({ error: 'Could not set up this device' });

  const { credential } = verification.registrationInfo;
  const device = typeof req.body.device === 'string' ? req.body.device.slice(0, 40) : null;
  db.prepare(
    `INSERT INTO passkeys (id, staff_id, role, public_key, counter, transports, device, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(credential.id, c.staffId, c.role, credential.publicKey, credential.counter,
    credential.transports ? JSON.stringify(credential.transports) : null, device, new Date().toISOString());

  if (c.staffId) {
    setupCodes.delete(c.code);
    const staff = db.prepare('SELECT id, name, role FROM staff WHERE id = ?').get(c.staffId);
    logActivity({ role: staff.role, staff }, 'passkey.added', `${staff.name} set up fingerprint / Face ID sign-in${device ? ` on ${device}` : ''}`);
    startSession(req, res, staff.role, staff.id);
    storeBroadcast('admin').emit('security.updated');
    return res.json({ home: storePath(req, `/${staff.role}`), name: staff.name });
  }
  logActivity({ role: 'admin' }, 'passkey.added', `Owner set up fingerprint / Face ID sign-in${device ? ` on ${device}` : ''}`);
  res.json({ ok: true });
});

// Sign in, step 1: the device shows its Face ID / fingerprint prompt and the passkeys it has.
app.post('/api/passkeys/login/options', async (req, res) => {
  const options = await generateAuthenticationOptions({ rpID: relyingParty(req).rpID, userVerification: 'required' });
  res.json({ options, challengeId: rememberChallenge(options.challenge, { purpose: 'login' }) });
});

// Sign in, step 2: check the signature, then open the screen as that person.
app.post('/api/passkeys/login', async (req, res) => {
  const { challengeId, response, role } = req.body ?? {};
  const c = takeChallenge(challengeId);
  if (!c || c.purpose !== 'login') return res.status(400).json({ error: 'Sign-in timed out. Try again.' });
  const wanted = isRole(role) ? role : 'admin';

  const passkey = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id ?? ''));
  if (!passkey) return res.status(401).json({ error: 'This fingerprint / Face ID sign-in was removed. Ask the owner to set it up again.' });
  const staff = passkey.staff_id ? db.prepare('SELECT id, name, role FROM staff WHERE id = ? AND active = 1').get(passkey.staff_id) : null;
  if (passkey.staff_id && !staff) return res.status(401).json({ error: 'This staff member was removed.' });
  if (!can(passkey.role, wanted)) {
    return res.status(403).json({ error: `${staff?.name ?? 'This person'} can't open the ${ROLE_LABEL[wanted] === 'Owner' ? 'admin panel' : ROLE_LABEL[wanted].toLowerCase() + ' screen'}.` });
  }

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: c.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: passkey.id, publicKey: new Uint8Array(passkey.public_key), counter: passkey.counter, transports: transportsOf(passkey) },
      requireUserVerification: true,
    });
  } catch (err) {
    return res.status(401).json({ error: `Sign-in failed: ${err.message}` });
  }
  if (!verification.verified) return res.status(401).json({ error: 'Sign-in failed' });

  db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
    .run(verification.authenticationInfo.newCounter, new Date().toISOString(), passkey.id);
  if (staff) logActivity({ role: staff.role, staff }, 'signed.in', `${staff.name} signed in`);
  startSession(req, res, passkey.role, staff?.id ?? 0);
  res.json({ home: storePath(req, `/${wanted}`), name: staff?.name ?? 'Owner' });
});

// ---------- Admin: staff and sign-in settings ----------

app.get('/api/admin/security', (req, res) => {
  const staff = db
    .prepare(
      `SELECT s.id, s.name, s.role, s.created_at, COUNT(p.id) AS passkeys, MAX(p.last_used_at) AS last_used_at
         FROM staff s LEFT JOIN passkeys p ON p.staff_id = s.id
        WHERE s.active = 1 GROUP BY s.id ORDER BY s.role, s.name`
    )
    .all();
  const passkeys = db
    .prepare('SELECT id, staff_id, role, device, created_at, last_used_at FROM passkeys ORDER BY created_at')
    .all();
  res.json({ staff, passkeys, pin: pinSettings(), pinSet: Object.fromEntries(PIN_ROLES.map((role) => [role, !!secretFor(role)])) });
});

app.post('/api/admin/staff', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const role = req.body?.role;
  if (!name || name.length > 40) return res.status(400).json({ error: 'Name must be 1–40 characters' });
  if (!['pos', 'barista', 'kitchen', 'inventory'].includes(role)) return res.status(400).json({ error: 'Choose cashier, barista, kitchen or inventory' });
  if (db.prepare('SELECT 1 FROM staff WHERE lower(name) = lower(?) AND active = 1').get(name)) {
    return res.status(400).json({ error: `${name} is already on the staff list` });
  }
  const id = Number(db.prepare('INSERT INTO staff (name, role, created_at) VALUES (?, ?, ?)').run(name, role, new Date().toISOString()).lastInsertRowid);
  logActivity(req, 'staff.added', `Added ${name} (${ROLE_LABEL[role]})`);
  res.status(201).json({ id, name, role, ...makeSetupCode(id) });
});

app.post('/api/admin/staff/:id/code', (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });
  res.json({ name: staff.name, ...makeSetupCode(staff.id) });
});

// Removing someone signs them out everywhere straight away and deletes their passkeys.
app.delete('/api/admin/staff/:id', (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });
  db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(staff.id);
  db.prepare('DELETE FROM passkeys WHERE staff_id = ?').run(staff.id);
  for (const [code, c] of setupCodes) if (c.store === req.store && c.staffId === staff.id) setupCodes.delete(code);
  logActivity(req, 'staff.removed', `Removed ${staff.name}`);
  for (const socket of io.sockets.sockets.values()) if (socket.data.staffId === staff.id) socket.disconnect(true);
  res.json({ ok: true });
});

app.delete('/api/admin/passkeys/:id', (req, res) => {
  const result = db.prepare('DELETE FROM passkeys WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Already removed' });
  logActivity(req, 'passkey.removed', 'Removed a fingerprint / Face ID sign-in');
  res.json({ ok: true });
});

// Shared PINs per staff screen: owner changes override the initial .env value.
const PIN_ROLES = ['pos', 'barista', 'kitchen', 'inventory'];
const pinSettings = () => Object.fromEntries(PIN_ROLES.map((role) => [role, pinAllowed(role)]));

app.post('/api/admin/pins/:role', (req, res) => {
  const role = req.params.role;
  const pin = req.body?.pin;
  if (!PIN_ROLES.includes(role)) return res.status(400).json({ error: 'Choose a staff screen' });
  if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4 to 12 digits' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  setSetting(`pin_${role}_hash`, `scrypt:${salt}:${hash}`);
  logActivity(req, 'settings.changed', `Changed the shared ${ROLE_LABEL[role].toLowerCase()} PIN`);
  res.json({ ok: true });
});

// Turn a shared staff-screen PIN on or off.
app.post('/api/admin/sign-in-settings', (req, res) => {
  for (const role of PIN_ROLES) {
    if (typeof req.body?.[role] !== 'boolean') continue;
    setSetting(`pin_${role}`, req.body[role] ? '1' : '0');
    logActivity(req, 'settings.changed', `${req.body[role] ? 'Allowed' : 'Turned off'} the shared ${ROLE_LABEL[role].toLowerCase()} PIN`);
  }
  res.json(pinSettings());
});

// ---------- Menu ----------

const catalogDetails = new Map(menuCatalog.map(item => [`${item.category}|${item.name}`, {
  description: item.description, descriptionNote: item.descriptionNote, descriptionSources: item.descriptionSources,
}]));

app.get('/api/menu', (req, res) => {
  const items = db
    .prepare(
      `SELECT id, name, category, price_cents, unavailable_since IS NULL AS available FROM menu_items
        WHERE active = 1 AND status = 'approved' ORDER BY id`
    )
    .all();
  // Shown greyed out on the POS so staff can see what's waiting.
  const pending = db
    .prepare("SELECT id, name, category, price_cents FROM menu_items WHERE status = 'pending' ORDER BY id")
    .all();
  const withDetails = item => ({ ...item, ...(req.store === 'ambiente' ? catalogDetails.get(`${item.category}|${item.name}`) : undefined) });
  res.json({ taxRate: TAX_RATE, receipt: receiptForStore(stationOf(req, req.query.station)), items: items.map(withDetails), pending: pending.map(withDetails) });
});

// Checks a proposed or edited menu item. Returns an error message, or null if it's fine.
function menuItemProblem({ name, category, priceCents }, ignoreId = 0) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return 'Name must be 1–60 characters';
  if (typeof category !== 'string' || !category.trim() || category.trim().length > 30) {
    return 'Category must be 1–30 characters';
  }
  if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > 1_000_000) return 'Enter a valid price';
  const duplicate = db
    .prepare(
      `SELECT status FROM menu_items
        WHERE lower(name) = lower(?) AND id != ? AND active = 1 AND status IN ('approved', 'pending')`
    )
    .get(name.trim(), ignoreId);
  if (duplicate) {
    return duplicate.status === 'pending' ? `"${name.trim()}" is already waiting for approval` : `"${name.trim()}" is already on the menu`;
  }
  return null;
}

// Staff propose a new item from the POS. The owner's own requests skip the queue.
app.post('/api/menu/requests', (req, res) => {
  const { name, category, priceCents, sendsToKitchen } = req.body ?? {};
  const problem = menuItemProblem({ name, category, priceCents });
  if (problem) return res.status(400).json({ error: problem });
  const status = req.role === 'admin' ? 'approved' : 'pending';
  const now = new Date().toISOString();
  const id = Number(
    db
      .prepare(
        `INSERT INTO menu_items (name, category, price_cents, sends_to_kitchen, status, requested_by, requested_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name.trim(), category.trim(), priceCents, sendsToKitchen === false ? 0 : 1, status, req.role, now,
        status === 'approved' ? now : null)
      .lastInsertRowid
  );
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  logActivity(req, status === 'pending' ? 'menu.requested' : 'menu.added',
    `${status === 'pending' ? 'Requested' : 'Added'} menu item ${item.name} (${item.category}) at ${money(item.price_cents)}`);

  if (status === 'pending') storeBroadcast('admin').emit('menu.requested', item);
  storeBroadcast(['pos', 'barista', 'admin']).emit('menu.updated');
  res.status(201).json(item);
});

// ---------- Inventory ----------

// Quantities can be fractions (2.5 kg), kept to 3 decimals so sums don't drift.
const roundQty = (n) => Math.round(n * 1000) / 1000;
const isQty = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1_000_000;
const isLow = (item) => item.quantity < item.threshold;
const qtyText = (item, n = item.quantity) => `${roundQty(n)} ${item.unit}`;

function inventoryItems() {
  return db.prepare('SELECT * FROM inventory_items WHERE active = 1 ORDER BY lower(name)').all()
    .map((i) => ({ ...i, low: isLow(i) }));
}

function inventoryProblem({ name, unit }, ignoreId = 0) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return 'Name must be 1–60 characters';
  if (typeof unit !== 'string' || !unit.trim() || unit.trim().length > 20) return 'Unit must be 1–20 characters, e.g. kg, L, pcs';
  if (db.prepare('SELECT 1 FROM inventory_items WHERE lower(name) = lower(?) AND id != ? AND active = 1').get(name.trim(), ignoreId)) {
    return `"${name.trim()}" is already in the inventory`;
  }
  return null;
}

function logStock(req, item, kind, change, note = null) {
  db.prepare(
    `INSERT INTO inventory_log (item_id, at, actor, actor_name, kind, change, quantity_after, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(item.id, new Date().toISOString(), req.role, req.staff?.name ?? null, kind, roundQty(change), item.quantity, note);
}

// Tells every screen the stock changed, and alerts the owner when an item has just dropped below its level.
function announceStock(req, before, after) {
  storeBroadcast([...STOCK_KEEPERS, 'admin']).emit('inventory.updated', { ...after, low: isLow(after) });
  if (isLow(after) && !(before && isLow(before))) {
    storeBroadcast('admin').emit('inventory.low', { ...after, low: true });
    logActivity(req, 'inventory.low', `Low stock: ${after.name} is at ${qtyText(after)} (reorder below ${qtyText(after, after.threshold)})`);
  }
}

app.get('/api/inventory', (req, res) => res.json(inventoryItems()));

// Staff and the owner add an item with its current stock and the level to reorder at.
app.post('/api/inventory/items', (req, res) => {
  const { name, unit, quantity, threshold } = req.body ?? {};
  const problem = inventoryProblem({ name, unit });
  if (problem) return res.status(400).json({ error: problem });
  if (!isQty(quantity)) return res.status(400).json({ error: 'Enter how much is in stock now' });
  if (!isQty(threshold)) return res.status(400).json({ error: 'Enter the level to reorder at' });
  const now = new Date().toISOString();
  const id = Number(db.prepare(
    `INSERT INTO inventory_items (name, unit, quantity, threshold, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(name.trim(), unit.trim(), roundQty(quantity), roundQty(threshold), now, now, req.staff?.name ?? ROLE_LABEL[req.role]).lastInsertRowid);
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id);
  logStock(req, item, 'added', item.quantity);
  announceStock(req, null, item);
  res.status(201).json({ ...item, low: isLow(item) });
});

// Staff update a stock level: a fresh count, a delivery received, or some used up or thrown away.
app.post('/api/inventory/:id/stock', (req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const { kind, amount } = req.body ?? {};
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 140) : null;
  if (!['count', 'received', 'used'].includes(kind)) return res.status(400).json({ error: 'Choose count, received or used' });
  if (!isQty(amount) || (kind !== 'count' && amount === 0)) return res.status(400).json({ error: 'Enter an amount' });
  if (kind === 'used' && amount > item.quantity + 1e-9) {
    return res.status(400).json({ error: `Only ${qtyText(item)} recorded. Do a count instead if that's wrong.` });
  }

  const quantity = roundQty(kind === 'count' ? amount : kind === 'received' ? item.quantity + amount : item.quantity - amount);
  db.prepare('UPDATE inventory_items SET quantity = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(quantity, new Date().toISOString(), req.staff?.name ?? ROLE_LABEL[req.role], item.id);
  const updated = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(item.id);
  logStock(req, updated, kind, quantity - item.quantity, note);
  announceStock(req, item, updated);
  res.json({ ...updated, low: isLow(updated) });
});

// Owner: everything in stock plus the latest changes.
app.get('/api/admin/inventory', (req, res) => {
  const log = db.prepare(
    `SELECT l.*, i.name, i.unit FROM inventory_log l JOIN inventory_items i ON i.id = l.item_id
      ORDER BY l.id DESC LIMIT 40`
  ).all();
  res.json({ items: inventoryItems(), log });
});

// Owner: rename, change the unit or the reorder level.
app.patch('/api/admin/inventory/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const edited = { name: req.body?.name ?? item.name, unit: req.body?.unit ?? item.unit, threshold: req.body?.threshold ?? item.threshold };
  const problem = inventoryProblem(edited, item.id);
  if (problem) return res.status(400).json({ error: problem });
  if (!isQty(edited.threshold)) return res.status(400).json({ error: 'Enter a valid reorder level' });
  db.prepare('UPDATE inventory_items SET name = ?, unit = ?, threshold = ? WHERE id = ?')
    .run(edited.name.trim(), edited.unit.trim(), roundQty(edited.threshold), item.id);
  const updated = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(item.id);
  if (updated.threshold !== item.threshold) {
    logStock(req, updated, 'edited', 0, `Reorder level ${qtyText(item, item.threshold)} → ${qtyText(updated, updated.threshold)}`);
  }
  announceStock(req, item, updated);
  res.json({ ...updated, low: isLow(updated) });
});

// Owner: stop tracking an item. Its history stays.
app.delete('/api/admin/inventory/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  db.prepare('UPDATE inventory_items SET active = 0 WHERE id = ?').run(item.id);
  logActivity(req, 'inventory.removed', `Stopped tracking ${item.name}`);
  storeBroadcast([...STOCK_KEEPERS, 'admin']).emit('inventory.updated', { ...item, active: 0 });
  res.json({ ok: true });
});

// Cashier or barista: mark an item unavailable (sold out, machine down…) or available again.
// Every till sees it straight away.
app.post('/api/menu/:id/availability', (req, res) => {
  const item = db.prepare("SELECT * FROM menu_items WHERE id = ? AND active = 1 AND status = 'approved'").get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const { available } = req.body ?? {};
  if (typeof available !== 'boolean') return res.status(400).json({ error: 'available must be true or false' });
  if (available === (item.unavailable_since === null)) return res.json({ id: item.id, available });
  db.prepare('UPDATE menu_items SET unavailable_since = ? WHERE id = ?').run(available ? null : new Date().toISOString(), item.id);
  logActivity(req, available ? 'menu.available' : 'menu.unavailable', `Marked ${item.name} ${available ? 'available again' : 'unavailable'}`);
  storeBroadcast(['pos', 'barista', 'admin']).emit('menu.updated');
  res.json({ id: item.id, available });
});

// ---------- Sales ----------

const findSellable = {
  get(id) { return db.prepare("SELECT * FROM menu_items WHERE id = ? AND active = 1 AND status = 'approved'").get(id); },
};

// POS or barista bar -> server: ring up a cash sale.
app.post('/api/orders', requireRole(...SELLERS), (req, res) => {
  const { clientId, items, createdAt, cashTenderedCents } = req.body ?? {};
  const station = stationOf(req, req.body?.station);
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 100) {
    return res.status(400).json({ error: 'clientId is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order has no items' });
  }

  // A retry of an order we already saved: return it instead of charging twice.
  const existing = db.prepare('SELECT id FROM orders WHERE client_id = ?').get(clientId);
  if (existing) return res.json(loadOrder(existing.id));

  // Prices come from the database, never from the client.
  const lines = [];
  const rungUpAt = saleTime(createdAt);
  for (const { menuItemId, qty } of items) {
    const menuItem = findSellable.get(Number(menuItemId));
    if (!menuItem) return res.status(400).json({ error: `Item ${menuItemId} is not on the menu` });
    // A sale saved offline before the item ran out still goes through.
    if (menuItem.unavailable_since && rungUpAt >= menuItem.unavailable_since) {
      return res.status(400).json({ error: `${menuItem.name} is marked unavailable` });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: `Invalid quantity for ${menuItem.name}` });
    }
    lines.push({ menuItem, qty });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.menuItem.price_cents * l.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  let tendered = null;
  if (cashTenderedCents !== undefined && cashTenderedCents !== null) {
    if (!Number.isInteger(cashTenderedCents) || cashTenderedCents < 0) {
      return res.status(400).json({ error: 'Invalid cash amount' });
    }
    if (cashTenderedCents < total) return res.status(400).json({ error: 'Cash received is less than the total' });
    tendered = cashTenderedCents;
  }
  const kitchenStatus = lines.some((l) => l.menuItem.sends_to_kitchen) ? 'new' : 'none';

  let orderId;
  db.exec('BEGIN');
  try {
    // Cashier receipts run 1001, 1002…; the barista bar has its own series, printed B-0001, B-0002…
    const { next } = db
      .prepare('SELECT COALESCE(MAX(receipt_no), ?) + 1 AS next FROM orders WHERE station = ?')
      .get(station === 'barista' ? 0 : 1000, station);
    orderId = Number(
      db
        .prepare(
          `INSERT INTO orders (client_id, station, receipt_no, created_at, payment_method, subtotal_cents, tax_cents,
             total_cents, kitchen_status, cash_tendered_cents, change_cents, staff_id, staff_name)
           VALUES (?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(clientId, station, next, rungUpAt, subtotal, tax, total, kitchenStatus, tendered,
          tendered === null ? null : tendered - total, req.staff?.id ?? null, req.staff?.name ?? null)
        .lastInsertRowid
    );
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, unit_price_cents, qty, sends_to_kitchen)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const { menuItem, qty } of lines) {
      insertItem.run(orderId, menuItem.id, menuItem.name, menuItem.price_cents, qty, menuItem.sends_to_kitchen);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const order = loadOrder(orderId);
  storeBroadcast(['kitchen', 'admin', 'pos', 'barista']).emit('order.created', order);
  notifyOwnerOverview();
  res.status(201).json(order);
});

// Cashiers and baristas may change or void today's receipts from their own till; the owner may change any.
function changeProblem(order, req) {
  if (!order) return [404, 'Receipt not found'];
  if (order.status === 'voided') return [409, `Receipt #${order.receipt_label} is already voided`];
  if (req.role !== 'admin' && order.station !== stationOf(req)) {
    return [403, `Receipt #${order.receipt_label} belongs to the ${order.station === 'barista' ? 'barista bar' : 'cashier'}. Change it there.`];
  }
  const [from, to] = dayRange();
  if (req.role !== 'admin' && !(order.created_at >= from && order.created_at < to)) {
    return [403, "Only today's receipts can be changed here. Ask the owner."];
  }
  return null;
}

// POS -> server: the customer changed their mind. Replaces the receipt's items.
// Items already on the receipt keep the price they were sold at; new items use today's price.
app.patch('/api/orders/:id', requireRole(...SELLERS), (req, res) => {
  const order = loadOrder(Number(req.params.id));
  const problem = changeProblem(order, req);
  if (problem) return res.status(problem[0]).json({ error: problem[1] });

  const { items } = req.body ?? {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'A receipt needs at least one item. Use Void to cancel the whole receipt.' });
  }

  const before = new Map(); // menu item id -> { name, unit_price_cents, sends_to_kitchen, qty }
  for (const i of order.items) {
    const prev = before.get(i.menu_item_id);
    before.set(i.menu_item_id, { ...i, qty: (prev?.qty ?? 0) + i.qty });
  }

  const wanted = new Map();
  for (const { menuItemId, qty } of items) {
    const id = Number(menuItemId);
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Invalid quantity' });
    wanted.set(id, (wanted.get(id) ?? 0) + qty);
  }

  const lines = [];
  for (const [id, qty] of wanted) {
    if (qty > 99) return res.status(400).json({ error: 'Invalid quantity' });
    const prev = before.get(id);
    if (prev) {
      lines.push({ menu_item_id: id, name: prev.name, unit_price_cents: prev.unit_price_cents, sends_to_kitchen: prev.sends_to_kitchen, qty });
      continue;
    }
    const menuItem = findSellable.get(id);
    if (!menuItem) return res.status(400).json({ error: `Item ${id} is not on the menu` });
    if (menuItem.unavailable_since) return res.status(400).json({ error: `${menuItem.name} is marked unavailable` });
    lines.push({ menu_item_id: id, name: menuItem.name, unit_price_cents: menuItem.price_cents, sends_to_kitchen: menuItem.sends_to_kitchen, qty });
  }

  // "+1 Fries, −1 Iced Tea" for the activity log.
  const changes = [];
  for (const id of new Set([...before.keys(), ...wanted.keys()])) {
    const diff = (wanted.get(id) ?? 0) - (before.get(id)?.qty ?? 0);
    const name = before.get(id)?.name ?? lines.find((l) => l.menu_item_id === id).name;
    if (diff) changes.push(`${diff > 0 ? '+' : '−'}${Math.abs(diff)} ${name}`);
  }
  if (changes.length === 0) return res.status(400).json({ error: 'Nothing was changed' });

  const subtotal = lines.reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;

  // Keep the kitchen in step: new kitchen items reopen a finished ticket,
  // and a ticket with no kitchen items left disappears.
  const hasKitchenItems = lines.some((l) => l.sends_to_kitchen);
  const moreForKitchen = lines.some((l) => l.sends_to_kitchen && l.qty > (before.get(l.menu_item_id)?.qty ?? 0));
  let kitchenStatus = order.kitchen_status;
  if (!hasKitchenItems && ['new', 'preparing', 'none'].includes(kitchenStatus)) kitchenStatus = 'none';
  else if (hasKitchenItems && kitchenStatus === 'none') kitchenStatus = 'new';
  else if (moreForKitchen && kitchenStatus === 'ready') kitchenStatus = 'new';
  const reopened = kitchenStatus === 'new' && order.kitchen_status !== 'new';

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, unit_price_cents, qty, sends_to_kitchen)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const l of lines) insertItem.run(order.id, l.menu_item_id, l.name, l.unit_price_cents, l.qty, l.sends_to_kitchen);
    db.prepare(
      `UPDATE orders SET subtotal_cents = ?, tax_cents = ?, total_cents = ?, kitchen_status = ?,
         kitchen_started_at = CASE WHEN ? THEN NULL ELSE kitchen_started_at END,
         kitchen_ready_at   = CASE WHEN ? THEN NULL ELSE kitchen_ready_at END,
         edited_at = ?, edit_count = edit_count + 1
       WHERE id = ?`
    ).run(subtotal, tax, total, kitchenStatus, reopened ? 1 : 0, reopened ? 1 : 0, new Date().toISOString(), order.id);
    logActivity(req, 'order.edited',
      `Edited receipt #${order.receipt_label}: ${changes.join(', ')} (${money(order.total_cents)} → ${money(total)})`, order.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin', 'pos', 'barista']).emit('order.updated', updated);
  notifyOwnerOverview();
  res.json({ order: updated, differenceCents: total - order.total_cents });
});

// POS -> server: cancel a whole receipt. It stays on record, marked voided, and no longer counts as a sale.
app.post('/api/orders/:id/void', requireRole(...SELLERS), (req, res) => {
  const order = loadOrder(Number(req.params.id));
  const problem = changeProblem(order, req);
  if (problem) return res.status(problem[0]).json({ error: problem[1] });

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 200) return res.status(400).json({ error: 'Give a reason for voiding (up to 200 characters)' });

  const kitchenStatus = ['new', 'preparing'].includes(order.kitchen_status) ? 'cancelled' : order.kitchen_status;
  db.prepare(
    `UPDATE orders SET status = 'voided', void_reason = ?, voided_at = ?, voided_by = ?, kitchen_status = ? WHERE id = ?`
  ).run(reason, new Date().toISOString(), req.role, kitchenStatus, order.id);
  logActivity(req, 'order.voided', `Voided receipt #${order.receipt_label} (${money(order.total_cents)}): ${reason}`, order.id);

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin', 'pos', 'barista']).emit('order.updated', updated);
  notifyOwnerOverview();
  res.json(updated);
});

// ---------- Cashier and barista: today only, their own till ----------

app.get('/api/pos/today', (req, res) => res.json(dayReport(localDate(), stationOf(req, req.query.station))));

// ---------- Kitchen ----------

// Kitchen display: every ticket not yet marked ready.
app.get('/api/kitchen/tickets', (req, res) => {
  const open = db
    .prepare("SELECT * FROM orders WHERE kitchen_status IN ('new', 'preparing') AND status = 'paid' ORDER BY id")
    .all();
  res.json(attachItems(open));
});

// Kitchen -> server: move a ticket along (new -> preparing -> ready).
app.patch('/api/orders/:id/kitchen', requireRole('kitchen'), (req, res) => {
  const { status } = req.body ?? {};
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const now = new Date().toISOString();
  if (status === 'preparing' && order.kitchen_status === 'new') {
    db.prepare("UPDATE orders SET kitchen_status = 'preparing', kitchen_started_at = ? WHERE id = ?").run(now, order.id);
  } else if (status === 'ready' && ['new', 'preparing'].includes(order.kitchen_status)) {
    db.prepare(
      "UPDATE orders SET kitchen_status = 'ready', kitchen_started_at = COALESCE(kitchen_started_at, ?), kitchen_ready_at = ? WHERE id = ?"
    ).run(now, now, order.id);
  } else {
    return res.status(409).json({ error: `Cannot move ticket from ${order.kitchen_status} to ${status}` });
  }

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin']).emit('ticket.updated', updated);
  res.json(updated);
});

// ---------- Admin: every day ----------

// One day's sales, receipts and activity log. Defaults to today.
app.get('/api/admin/day', (req, res) => {
  const date = req.query.date ?? localDate();
  if (!isDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const logs = db.prepare('SELECT * FROM activity_log WHERE business_date = ? ORDER BY id DESC').all(date);
  res.json({ ...dayReport(date), logs });
});

// The Ambiente owner sees both stores without merging their operational data.
app.get('/api/admin/stores', (req, res) => {
  if (req.store !== 'ambiente') return res.status(403).json({ error: 'Open the Ambiente owner dashboard' });
  const date = req.query.date ?? localDate();
  if (!isDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const stores = Object.entries(STORES).map(([id, store]) => ({
    id, name: store.name,
    summary: storeContext.run(id, () => dayReport(date).summary),
  }));
  res.json({ date, stores });
});

// Daily performance for the last N days (default 30), newest first. Quiet days are left out.
app.get('/api/admin/history', (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 366);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const byDate = new Map();
  for (let i = 0; i < days; i++) {
    const date = localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    byDate.set(date, { date, order_count: 0, gross_cents: 0, void_count: 0, void_cents: 0, edited_count: 0 });
  }
  const orders = db
    .prepare('SELECT created_at, status, total_cents, edit_count FROM orders WHERE created_at >= ?')
    .all(start.toISOString());
  for (const o of orders) {
    const row = byDate.get(localDate(new Date(o.created_at)));
    if (!row) continue;
    if (o.status === 'paid') {
      row.order_count++;
      row.gross_cents += o.total_cents;
    } else {
      row.void_count++;
      row.void_cents += o.total_cents;
    }
    if (o.edit_count > 0) row.edited_count++;
  }
  const today = localDate();
  res.json(
    [...byDate.values()].reverse().filter((r) => r.date === today || r.order_count || r.void_count)
  );
});

// The week (Monday to Sunday), month or year that contains `date`, plus the one before it.
function periodRange(unit, date) {
  const [y, m, d] = date.split('-').map(Number);
  if (unit === 'week') {
    const monday = d - ((new Date(y, m - 1, d).getDay() + 6) % 7);
    return { start: new Date(y, m - 1, monday), end: new Date(y, m - 1, monday + 7), prevStart: new Date(y, m - 1, monday - 7) };
  }
  if (unit === 'month') return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), prevStart: new Date(y, m - 2, 1) };
  return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), prevStart: new Date(y - 1, 0, 1) };
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((b - a) / 86_400_000);

// ----- Seasonal events -----

const hiddenEvents = () => new Set(JSON.parse(getSetting('hidden_events', '[]')));

// Built-in and owner-added events that touch the dates from..to (inclusive, YYYY-MM-DD).
function eventsBetween(from, to, { includeHidden = false } = {}) {
  const hidden = hiddenEvents();
  const list = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const e of builtInEvents(y)) list.push({ ...e, hidden: hidden.has(e.key) });
  }
  for (const e of db.prepare('SELECT * FROM events WHERE start_date <= ? AND end_date >= ?').all(to, from)) {
    list.push({ key: `custom:${e.name.toLowerCase()}`, name: e.name, kind: e.kind, start: e.start_date, end: e.end_date, note: e.note, custom_id: e.id, hidden: false });
  }
  return list.filter((e) => e.start <= to && e.end >= from && (includeHidden || !e.hidden));
}

const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function datesOf(start, end) {
  const out = [];
  const [y, m, d] = start.split('-').map(Number);
  for (let i = 0; ; i++) {
    const date = localDate(new Date(y, m - 1, d + i));
    if (date > end) return out;
    out.push(date);
  }
}

// Paid sales per local day between two local dates. Grouped by UTC hour in SQL first, which
// keeps it quick over a couple of years of receipts.
function dailySales(from, to) {
  const [startIso] = dayRange(from);
  const [, endIso] = dayRange(to);
  const byDay = new Map();
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 13) AS hour, SUM(total_cents) AS gross_cents, COUNT(*) AS order_count
         FROM orders WHERE status = 'paid' AND created_at >= ? AND created_at < ? GROUP BY hour`
    )
    .all(startIso, endIso);
  for (const r of rows) {
    const day = localDate(new Date(`${r.hour}:00:00Z`));
    const cur = byDay.get(day) ?? { gross_cents: 0, order_count: 0 };
    cur.gross_cents += r.gross_cents;
    cur.order_count += r.order_count;
    byDay.set(day, cur);
  }
  return byDay;
}

// How each event in the period sold: per day during the event, against the 28 normal days
// before it, and against the same event last year.
function eventPerformance(periodStart, periodEnd) {
  const today = localDate();
  const events = eventsBetween(periodStart, periodEnd, { includeHidden: true });
  if (!events.length) return [];
  const firstSale = db.prepare("SELECT MIN(created_at) AS at FROM orders WHERE status = 'paid'").get().at;
  const opened = firstSale ? localDate(new Date(firstSale)) : null;

  const lastYearOf = (e) => {
    const y = Number(e.start.slice(0, 4)) - 1;
    if (e.custom_id) {
      return db.prepare('SELECT start_date AS start, end_date AS end FROM events WHERE lower(name) = lower(?) AND start_date LIKE ?')
        .get(e.name, `${y}-%`) ?? null;
    }
    return builtInEvents(y).find((p) => p.key === e.key) ?? null;
  };
  const earliest = events.reduce((min, e) => {
    const ly = lastYearOf(e);
    const candidates = [e.start, ly?.start].filter(Boolean);
    return candidates.reduce((a, b) => (b < a ? b : a), min);
  }, periodStart);
  const from = localDate(addDays(parseDay(earliest), -90));
  const sales = dailySales(from, periodEnd > today ? today : periodEnd);
  // Days inside any event aren't "normal" days.
  const eventDays = new Set(eventsBetween(from, periodEnd).flatMap((e) => datesOf(e.start, e.end)));

  const measure = (start, end) => {
    const days = datesOf(start, end).filter((d) => d <= today && opened && d >= opened);
    if (!days.length) return null;
    const gross = days.reduce((n, d) => n + (sales.get(d)?.gross_cents ?? 0), 0);
    const orders = days.reduce((n, d) => n + (sales.get(d)?.order_count ?? 0), 0);
    return { start, end, days: days.length, gross_cents: gross, order_count: orders, per_day_cents: Math.round(gross / days.length) };
  };

  return events.map((e) => {
    const during = measure(e.start, e.end);
    let baseline = null;
    if (during) {
      // The 28 most recent normal days before it, looking back up to 90 days (a fiesta day
      // straight after a month-long festival still gets a fair comparison).
      const before = datesOf(localDate(addDays(parseDay(e.start), -90)), e.start)
        .filter((d) => d < e.start && !eventDays.has(d) && opened && d >= opened)
        .slice(-28);
      if (before.length >= 7) baseline = Math.round(before.reduce((n, d) => n + (sales.get(d)?.gross_cents ?? 0), 0) / before.length);
    }
    const ly = lastYearOf(e);
    const lastYear = ly ? measure(ly.start, ly.end) : null;
    return {
      ...e,
      status: e.start > today ? 'upcoming' : e.end >= today ? 'ongoing' : 'past',
      during,
      baseline_per_day_cents: baseline,
      lift_pct: during && baseline ? Math.round(((during.per_day_cents - baseline) / baseline) * 100) : null,
      last_year: lastYear,
    };
  });
}

// Sales for a week, month or year: one bar per day (or per month for a year), totals,
// a fair comparison with the period before, and what sold best.
app.get('/api/admin/period', (req, res) => {
  const unit = req.query.unit ?? 'month';
  if (!['week', 'month', 'year'].includes(unit)) return res.status(400).json({ error: 'unit must be week, month or year' });
  const date = req.query.date ?? localDate();
  if (!isDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  const { start, end, prevStart } = periodRange(unit, date);
  const today = localDate();
  const tomorrow = addDays(new Date(), 1);
  tomorrow.setHours(0, 0, 0, 0);
  const isCurrent = start < tomorrow && tomorrow <= end;
  // Days that have happened so far. A period still under way is compared with the same
  // number of days at the start of the previous one, not the whole of it.
  const totalDays = daysBetween(start, end);
  const elapsedDays = start >= tomorrow ? 0 : isCurrent ? daysBetween(start, tomorrow) : totalDays;
  const prevEnd = isCurrent ? new Date(Math.min(addDays(prevStart, elapsedDays), start)) : start;

  const buckets = new Map();
  if (unit === 'year') {
    for (let i = 0; i < 12; i++) {
      const key = `${start.getFullYear()}-${String(i + 1).padStart(2, '0')}`;
      buckets.set(key, { key, future: key > today.slice(0, 7) });
    }
  } else {
    for (let d = start; d < end; d = addDays(d, 1)) {
      const key = localDate(d);
      buckets.set(key, { key, future: key > today });
    }
  }
  for (const b of buckets.values()) Object.assign(b, { order_count: 0, gross_cents: 0, void_count: 0, void_cents: 0 });

  const summary = { order_count: 0, gross_cents: 0, void_count: 0, void_cents: 0, edited_count: 0, trading_days: 0 };
  const hours = Array.from({ length: 24 }, () => ({ order_count: 0, gross_cents: 0 }));
  const salesByDay = new Map();
  const receiptsByDay = new Map();
  const orders = db
    .prepare('SELECT created_at, status, total_cents, edit_count FROM orders WHERE created_at >= ? AND created_at < ?')
    .all(start.toISOString(), end.toISOString());
  for (const o of orders) {
    const at = new Date(o.created_at);
    const day = localDate(at);
    const bucket = buckets.get(unit === 'year' ? day.slice(0, 7) : day);
    if (o.status === 'paid') {
      bucket.order_count++;
      bucket.gross_cents += o.total_cents;
      summary.order_count++;
      summary.gross_cents += o.total_cents;
      hours[at.getHours()].order_count++;
      hours[at.getHours()].gross_cents += o.total_cents;
      salesByDay.set(day, (salesByDay.get(day) ?? 0) + o.total_cents);
      receiptsByDay.set(day, (receiptsByDay.get(day) ?? 0) + 1);
    } else {
      bucket.void_count++;
      bucket.void_cents += o.total_cents;
      summary.void_count++;
      summary.void_cents += o.total_cents;
    }
    if (o.edit_count > 0) summary.edited_count++;
  }
  summary.trading_days = salesByDay.size;

  // Average sales per weekday (0 = Sunday), over the days that have happened.
  const weekdays = Array.from({ length: 7 }, (_, weekday) => ({ weekday, days: 0, gross_cents: 0 }));
  for (let d = start, i = 0; i < elapsedDays; d = addDays(d, 1), i++) {
    weekdays[d.getDay()].days++;
    weekdays[d.getDay()].gross_cents += salesByDay.get(localDate(d)) ?? 0;
  }

  const previous = db
    .prepare(
      `SELECT COALESCE(SUM(status = 'paid'), 0)                                 AS order_count,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents END), 0) AS gross_cents
         FROM orders WHERE created_at >= ? AND created_at < ?`
    )
    .get(prevStart.toISOString(), prevEnd.toISOString());

  const range = [start.toISOString(), end.toISOString()];
  const topItems = db
    .prepare(
      `SELECT MAX(oi.name) AS name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price_cents) AS revenue_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status = 'paid'
        GROUP BY oi.menu_item_id
        ORDER BY revenue_cents DESC, qty DESC
        LIMIT 8`
    )
    .all(...range);
  const categories = db
    .prepare(
      `SELECT m.category, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price_cents) AS revenue_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN menu_items m ON m.id = oi.menu_item_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status = 'paid'
        GROUP BY m.category
        ORDER BY revenue_cents DESC`
    )
    .all(...range);

  res.json({
    unit,
    start: localDate(start),
    end: localDate(addDays(end, -1)),
    isCurrent,
    elapsedDays,
    totalDays,
    buckets: [...buckets.values()],
    summary,
    previous: { ...previous, start: localDate(prevStart), end: localDate(addDays(prevEnd, -1)), partial: isCurrent },
    hours,
    weekdays,
    topItems,
    categories,
    events: eventPerformance(localDate(start), localDate(addDays(end, -1))),
    // Every day of the period, for the full-year calendar (?daily=1).
    days: req.query.daily ? datesOf(localDate(start), localDate(addDays(end, -1))).map((key) => ({
      key, future: key > today, gross_cents: salesByDay.get(key) ?? 0, order_count: receiptsByDay.get(key) ?? 0,
    })) : undefined,
    payday: paydayStats(salesByDay, start, elapsedDays),
  });
});

// Filipinos are paid on the 15th and the last day of the month; spending jumps that day and the next.
function paydayStats(salesByDay, start, elapsedDays) {
  const pay = { days: 0, gross_cents: 0 }, other = { days: 0, gross_cents: 0 };
  for (let i = 0; i < elapsedDays; i++) {
    const d = addDays(start, i);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const isPay = [15, 16, lastDay, 1].includes(d.getDate());
    const bucket = isPay ? pay : other;
    bucket.days++;
    bucket.gross_cents += salesByDay.get(localDate(d)) ?? 0;
  }
  return {
    payday_per_day_cents: pay.days ? Math.round(pay.gross_cents / pay.days) : null,
    other_per_day_cents: other.days ? Math.round(other.gross_cents / other.days) : null,
    payday_days: pay.days,
  };
}

// Owner: add an event of their own, or hide / show a built-in one.
app.post('/api/admin/events', (req, res) => {
  const { name, start, end, kind, note } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return res.status(400).json({ error: 'Name must be 1–60 characters' });
  if (!isDate(start) || !isDate(end) || end < start) return res.status(400).json({ error: 'Pick a start date and an end date on or after it' });
  if (!['iligan', 'national'].includes(kind)) return res.status(400).json({ error: 'Choose Iligan or Philippines' });
  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 140) : null;
  const id = Number(db.prepare('INSERT INTO events (name, start_date, end_date, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), start, end, kind, cleanNote, new Date().toISOString()).lastInsertRowid);
  logActivity(req, 'event.added', `Added event ${name.trim()} (${start}${end !== start ? ` to ${end}` : ''})`);
  res.status(201).json({ id });
});

app.delete('/api/admin/events/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) return res.status(404).json({ error: 'Event not found' });
  db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  logActivity(req, 'event.removed', `Removed event ${event.name}`);
  res.json({ ok: true });
});

app.post('/api/admin/events/visibility', (req, res) => {
  const { key, hidden } = req.body ?? {};
  if (typeof key !== 'string' || key.startsWith('custom:') || typeof hidden !== 'boolean') return res.status(400).json({ error: 'Unknown event' });
  const set = hiddenEvents();
  if (hidden) set.add(key);
  else set.delete(key);
  setSetting('hidden_events', JSON.stringify([...set]));
  res.json({ hidden: [...set] });
});

// Admin: items waiting for approval.
app.get('/api/admin/menu-requests', (req, res) => {
  res.json(db.prepare("SELECT * FROM menu_items WHERE status = 'pending' ORDER BY id").all());
});

// Admin: approve (optionally fixing name, category or price first) or reject.
app.post('/api/admin/menu-requests/:id', (req, res) => {
  const item = db.prepare("SELECT * FROM menu_items WHERE id = ? AND status = 'pending'").get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'This request was already handled' });

  const { decision } = req.body ?? {};
  const now = new Date().toISOString();
  if (decision === 'reject') {
    db.prepare("UPDATE menu_items SET status = 'rejected', active = 0, reviewed_at = ? WHERE id = ?").run(now, item.id);
    logActivity(req, 'menu.rejected', `Rejected menu item ${item.name}`);
  } else if (decision === 'approve') {
    const edited = {
      name: req.body.name ?? item.name,
      category: req.body.category ?? item.category,
      priceCents: req.body.priceCents ?? item.price_cents,
    };
    const problem = menuItemProblem(edited, item.id);
    if (problem) return res.status(400).json({ error: problem });
    db.prepare(
      "UPDATE menu_items SET status = 'approved', name = ?, category = ?, price_cents = ?, reviewed_at = ? WHERE id = ?"
    ).run(edited.name.trim(), edited.category.trim(), edited.priceCents, now, item.id);
    logActivity(req, 'menu.approved',
      `Approved menu item ${edited.name.trim()} (${edited.category.trim()}) at ${money(edited.priceCents)}`);
  } else {
    return res.status(400).json({ error: 'decision must be approve or reject' });
  }

  storeBroadcast(['pos', 'barista', 'admin']).emit('menu.updated');
  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(item.id));
});

// React client routes fall through to Vite's built entry point. API misses stay JSON 404s.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const entry = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(entry)) return res.sendFile(entry);
  res.status(503).send('Frontend is not built yet. Run npm run build.');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Live updates need a login too. Each screen joins a room named after its role,
// and each broadcast above names the rooms that need it.
io.use((socket, next) => {
  const store = socket.handshake.auth?.store === 'rairock' ? 'rairock' : 'ambiente';
  const session = storeContext.run(store, () => readSession(socket.handshake.headers.cookie));
  if (!session) return next(new Error('unauthorized'));
  socket.data.store = store;
  socket.data.role = session.role;
  socket.data.staffId = session.staff?.id ?? 0;
  next();
});
io.on('connection', (socket) => socket.join(`${socket.data.store}:${socket.data.role}`));

// Close the database cleanly when stopped or restarted (npm run dev restarts on every edit),
// so the next start never finds it locked.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    io.close();
    httpServer.close();
    for (const database of Object.values(databases)) database.close();
    process.exit(0);
  });
}

httpServer.listen(PORT, () => {
  // Addresses the iPad and kitchen screen can use on the same Wi-Fi.
  const lanHosts = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a?.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  console.log(`5 Way System running on port ${PORT}`);
  for (const host of ['localhost', ...lanHosts]) {
    console.log(`  http://${host}:${PORT}   (Ambiente: /pos, /admin · RaiRock: /rairock/pos, /rairock/admin)`);
  }
});
