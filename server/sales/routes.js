import { TAX_RATE } from '../core/config.js';
import { receiptLabel, requireRole, SELLERS, stationOf } from '../auth/sessions.js';
import { dayRange, localDate, money } from '../core/dates.js';
import { db } from '../core/db.js';
import { dayReport, loadOrder, logActivity, saleTime } from './orders.js';
import { app, notifyOwnerOverview, storeBroadcast } from '../core/http.js';
import { applyRecipes } from '../inventory/routes.js';
import { announceTables, openTableOrders } from '../tables/routes.js';

// ---------- Sales ----------

export const findSellable = {
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

  // Dine-in: which table, how many, and when they sat down. No table = takeout / counter.
  let table = null, guests = null, customerTag = null, seatedAt = null;
  if (req.body?.table) {
    const { tableId, guests: g, customerTag: tag, seatedAt: seated } = req.body.table;
    table = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(Number(tableId));
    if (!table) return res.status(400).json({ error: 'That table no longer exists' });
    if (g !== undefined && g !== null && (!Number.isInteger(g) || g < 1 || g > 50)) return res.status(400).json({ error: 'Guests must be 1–50' });
    if (tag && !['vip', 'repeat'].includes(tag)) return res.status(400).json({ error: 'Unknown customer type' });
    guests = g ?? null;
    customerTag = tag || null;
    // A party adding to their table keeps the time they first sat down.
    const already = openTableOrders(table.id)[0];
    seatedAt = already ? already.seated_at ?? already.created_at : seated ? saleTime(seated) : rungUpAt;
    if (seatedAt > rungUpAt) seatedAt = rungUpAt;
  }

  let orderId, announceStockChanges;
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
             total_cents, kitchen_status, cash_tendered_cents, change_cents, staff_id, staff_name,
             table_id, table_name, guests, customer_tag, seated_at)
           VALUES (?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(clientId, station, next, rungUpAt, subtotal, tax, total, kitchenStatus, tendered,
          tendered === null ? null : tendered - total, req.staff?.id ?? null, req.staff?.name ?? null,
          table?.id ?? null, table?.name ?? null, guests, customerTag, seatedAt)
        .lastInsertRowid
    );
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, unit_price_cents, qty, sends_to_kitchen)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const { menuItem, qty } of lines) {
      insertItem.run(orderId, menuItem.id, menuItem.name, menuItem.price_cents, qty, menuItem.sends_to_kitchen);
    }
    const sold = new Map();
    for (const { menuItem, qty } of lines) sold.set(menuItem.id, (sold.get(menuItem.id) ?? 0) + qty);
    announceStockChanges = applyRecipes(req, sold, `Receipt #${receiptLabel({ station, receipt_no: next })}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  announceStockChanges();

  const order = loadOrder(orderId);
  storeBroadcast(['kitchen', 'admin', 'pos', 'barista']).emit('order.created', order);
  if (order.table_id) announceTables();
  notifyOwnerOverview();
  res.status(201).json(order);
});

// Cashiers and baristas may change or void today's receipts from their own till; the owner may change any.
export function changeProblem(order, req) {
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
  // An item the kitchen already marked ready stays ready unless more of it was added.
  const readyAt = new Map();
  for (const i of order.items) {
    const ready = readyAt.has(i.menu_item_id) ? readyAt.get(i.menu_item_id) && i.kitchen_ready_at : i.kitchen_ready_at;
    readyAt.set(i.menu_item_id, ready || null);
  }
  for (const l of lines) l.kitchen_ready_at = l.qty <= (before.get(l.menu_item_id)?.qty ?? 0) ? readyAt.get(l.menu_item_id) ?? null : null;
  const hasKitchenItems = lines.some((l) => l.sends_to_kitchen);
  const moreForKitchen = lines.some((l) => l.sends_to_kitchen && l.qty > (before.get(l.menu_item_id)?.qty ?? 0));
  const allReady = hasKitchenItems && lines.every((l) => !l.sends_to_kitchen || l.kitchen_ready_at);
  let kitchenStatus = order.kitchen_status;
  if (!hasKitchenItems && ['new', 'preparing', 'none'].includes(kitchenStatus)) kitchenStatus = 'none';
  else if (hasKitchenItems && kitchenStatus === 'none') kitchenStatus = 'new';
  else if (moreForKitchen && kitchenStatus === 'ready') kitchenStatus = 'new';
  else if (allReady && ['new', 'preparing'].includes(kitchenStatus)) kitchenStatus = 'ready';
  const reopened = kitchenStatus === 'new' && order.kitchen_status !== 'new';
  const finished = kitchenStatus === 'ready' && order.kitchen_status !== 'ready';
  const sold = new Map();
  for (const id of new Set([...before.keys(), ...wanted.keys()])) sold.set(id, (wanted.get(id) ?? 0) - (before.get(id)?.qty ?? 0));
  let announceStockChanges;

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, unit_price_cents, qty, sends_to_kitchen, kitchen_ready_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const l of lines) insertItem.run(order.id, l.menu_item_id, l.name, l.unit_price_cents, l.qty, l.sends_to_kitchen, l.kitchen_ready_at);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE orders SET subtotal_cents = ?, tax_cents = ?, total_cents = ?, kitchen_status = ?,
         kitchen_started_at = CASE WHEN ? THEN NULL ELSE kitchen_started_at END,
         kitchen_ready_at   = CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE kitchen_ready_at END,
         edited_at = ?, edit_count = edit_count + 1
       WHERE id = ?`
    ).run(subtotal, tax, total, kitchenStatus, reopened ? 1 : 0, reopened ? 1 : 0, finished ? 1 : 0, now, now, order.id);
    logActivity(req, 'order.edited',
      `Edited receipt #${order.receipt_label}: ${changes.join(', ')} (${money(order.total_cents)} → ${money(total)})`, order.id);
    announceStockChanges = applyRecipes(req, sold, `Receipt #${order.receipt_label} edited`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  announceStockChanges();

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin', 'pos', 'barista']).emit('order.updated', updated);
  if (updated.table_id) announceTables();
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
  const returned = new Map();
  for (const i of order.items) returned.set(i.menu_item_id, (returned.get(i.menu_item_id) ?? 0) - i.qty);
  let announceStockChanges;
  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE orders SET status = 'voided', void_reason = ?, voided_at = ?, voided_by = ?, kitchen_status = ? WHERE id = ?`
    ).run(reason, new Date().toISOString(), req.role, kitchenStatus, order.id);
    logActivity(req, 'order.voided', `Voided receipt #${order.receipt_label} (${money(order.total_cents)}): ${reason}`, order.id);
    announceStockChanges = applyRecipes(req, returned, `Receipt #${order.receipt_label} voided`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  announceStockChanges();

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin', 'pos', 'barista']).emit('order.updated', updated);
  if (updated.table_id) announceTables();
  notifyOwnerOverview();
  res.json(updated);
});

// ---------- Cashier and barista: today only, their own till ----------

app.get('/api/pos/today', (req, res) => res.json(dayReport(localDate(), stationOf(req, req.query.station))));
