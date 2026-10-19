import { receiptLabel, requireRole, SELLERS } from '../auth/sessions.js';
import { dayRange, money } from '../core/dates.js';
import { db } from '../core/db.js';
import { resized, tableSize } from './seed.js';
import { logActivity } from '../sales/orders.js';
import { app, storeBroadcast } from '../core/http.js';

// ---------- Tables ----------

// Receipts rung up today for a table that hasn't billed out yet. A party left open overnight
// doesn't keep the table busy the next day.
export function openTableOrders(tableId = null) {
  const [from] = dayRange();
  return db.prepare(
    `SELECT * FROM orders WHERE status = 'paid' AND table_id IS NOT NULL AND billed_out_at IS NULL AND created_at >= ?
       ${tableId ? 'AND table_id = ?' : ''} ORDER BY created_at`
  ).all(...(tableId ? [from, tableId] : [from]));
}

export function diningTables() {
  const open = new Map();
  for (const o of openTableOrders()) {
    const party = open.get(o.table_id) ?? { seated_at: o.seated_at ?? o.created_at, guests: 0, customer_tag: null, total_cents: 0, receipts: [] };
    party.guests = Math.max(party.guests, o.guests ?? 0);
    party.customer_tag = party.customer_tag ?? o.customer_tag;
    party.total_cents += o.total_cents;
    party.receipts.push({ id: o.id, label: receiptLabel(o), total_cents: o.total_cents, created_at: o.created_at });
    open.set(o.table_id, party);
  }
  return db.prepare('SELECT * FROM dining_tables WHERE active = 1 ORDER BY id').all()
    .map((t) => ({ ...t, party: open.get(t.id) ?? null }));
}

export const announceTables = () => storeBroadcast(['pos', 'barista', 'kitchen', 'admin']).emit('tables.updated');

app.get('/api/tables', requireRole(...SELLERS, 'kitchen'), (req, res) => res.json(diningTables()));

// Cashier or barista: the party paid up and left. The table is free and its receipts get the exit time.
app.post('/api/tables/:id/bill-out', requireRole(...SELLERS), (req, res) => {
  const table = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(Number(req.params.id));
  if (!table) return res.status(404).json({ error: 'Table not found' });
  const open = openTableOrders(table.id);
  if (!open.length) return res.status(409).json({ error: `${table.name} is already free` });
  const now = new Date().toISOString();
  const stay = Math.round((Date.parse(now) - Date.parse(open[0].seated_at ?? open[0].created_at)) / 60000);
  db.exec('BEGIN');
  try {
    const mark = db.prepare('UPDATE orders SET billed_out_at = ? WHERE id = ?');
    for (const o of open) mark.run(now, o.id);
    logActivity(req, 'table.billed_out',
      `${table.name} billed out after ${stay} min · ${open.map((o) => `#${receiptLabel(o)}`).join(', ')} · ${money(open.reduce((n, o) => n + o.total_cents, 0))}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  announceTables();
  res.json({ ok: true });
});

export function tableProblem({ name, seats }, ignoreId = 0) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 30) return 'Table name must be 1–30 characters';
  if (!Number.isInteger(seats) || seats < 1 || seats > 50) return 'Seats must be 1–50';
  if (db.prepare('SELECT 1 FROM dining_tables WHERE lower(name) = lower(?) AND id != ? AND active = 1').get(name.trim(), ignoreId)) {
    return `There is already a table called "${name.trim()}"`;
  }
  return null;
}
export const onMap = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;

app.get('/api/admin/tables', (req, res) => res.json(diningTables()));

// Owner: a new table appears in the bottom-left corner of the map, ready to be dragged into place.
app.post('/api/admin/tables', (req, res) => {
  const name = req.body?.name, seats = Number(req.body?.seats);
  const problem = tableProblem({ name, seats });
  if (problem) return res.status(400).json({ error: problem });
  const id = Number(db.prepare('INSERT INTO dining_tables (name, seats, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), seats, 30, 640, tableSize(seats).w, tableSize(seats).h, new Date().toISOString()).lastInsertRowid);
  logActivity(req, 'table.added', `Added ${name.trim()} (${seats} seats)`);
  announceTables();
  res.status(201).json(db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(id));
});

// Owner: rename, change seats, or move a table on the map.
app.patch('/api/admin/tables/:id', (req, res) => {
  const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!table) return res.status(404).json({ error: 'Table not found' });
  const next = { ...table, ...req.body, seats: req.body?.seats === undefined ? table.seats : Number(req.body.seats) };
  const problem = tableProblem(next, table.id);
  if (problem) return res.status(400).json({ error: problem });
  if (!onMap(next.x, 1280) || !onMap(next.y, 720)) return res.status(400).json({ error: 'Table is off the map' });
  // Going from a 2-seater to a bigger table (or back) changes its shape.
  const shape = (next.seats <= 2) === (table.seats <= 2) ? { ...next, w: table.w, h: table.h } : { ...next, ...resized({ ...table, x: next.x, y: next.y }, next.seats) };
  db.prepare('UPDATE dining_tables SET name = ?, seats = ?, x = ?, y = ?, w = ?, h = ? WHERE id = ?')
    .run(next.name.trim(), next.seats, Math.round(shape.x), Math.round(shape.y), shape.w, shape.h, table.id);
  if (next.name.trim() !== table.name || next.seats !== table.seats) {
    logActivity(req, 'table.edited', `${table.name} (${table.seats} seats) → ${next.name.trim()} (${next.seats} seats)`);
  }
  announceTables();
  res.json(db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(table.id));
});

// Owner: remove a table. Past receipts keep the table's name.
app.delete('/api/admin/tables/:id', (req, res) => {
  const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (openTableOrders(table.id).length) return res.status(409).json({ error: `${table.name} has guests. Bill them out first.` });
  db.prepare('UPDATE dining_tables SET active = 0 WHERE id = ?').run(table.id);
  logActivity(req, 'table.removed', `Removed ${table.name}`);
  announceTables();
  res.json({ ok: true });
});
