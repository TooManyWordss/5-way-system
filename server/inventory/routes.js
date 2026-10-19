import { STOCK_KEEPERS } from '../core/config.js';
import { db } from '../core/db.js';
import { logActivity } from '../sales/orders.js';
import { app, storeBroadcast } from '../core/http.js';
import { ROLE_LABEL } from '../passkeys/routes.js';

// ---------- Inventory ----------

// Quantities can be fractions (2.5 kg), kept to 3 decimals so sums don't drift.
export const roundQty = (n) => Math.round(n * 1000) / 1000;
export const isQty = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1_000_000;
export const isLow = (item) => item.quantity < item.threshold;
export const qtyText = (item, n = item.quantity) => `${roundQty(n)} ${item.unit}`;

export function inventoryItems() {
  return db.prepare('SELECT * FROM inventory_items WHERE active = 1 ORDER BY lower(name)').all()
    .map((i) => ({ ...i, low: isLow(i) }));
}

export function inventoryProblem({ name, unit }, ignoreId = 0) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return 'Name must be 1–60 characters';
  if (typeof unit !== 'string' || !unit.trim() || unit.trim().length > 20) return 'Unit must be 1–20 characters, e.g. kg, L, pcs';
  if (db.prepare('SELECT 1 FROM inventory_items WHERE lower(name) = lower(?) AND id != ? AND active = 1').get(name.trim(), ignoreId)) {
    return `"${name.trim()}" is already in the inventory`;
  }
  return null;
}

export function logStock(req, item, kind, change, note = null) {
  db.prepare(
    `INSERT INTO inventory_log (item_id, at, actor, actor_name, kind, change, quantity_after, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(item.id, new Date().toISOString(), req.role, req.staff?.name ?? null, kind, roundQty(change), item.quantity, note);
}

// Tells every screen the stock changed, and alerts the owner when an item has just dropped below its level.
export function announceStock(req, before, after) {
  storeBroadcast([...STOCK_KEEPERS, 'admin']).emit('inventory.updated', { ...after, low: isLow(after) });
  if (isLow(after) && !(before && isLow(before))) {
    storeBroadcast('admin').emit('inventory.low', { ...after, low: true });
    logActivity(req, 'inventory.low', `Low stock: ${after.name} is at ${qtyText(after)} (reorder below ${qtyText(after, after.threshold)})`);
  }
}

// Takes out (or, for a negative count, puts back) what the menu items use from stock.
// `soldByMenuItem` maps menu item id -> how many more were sold (negative when returned).
// Call inside the sale's transaction; call the returned function after COMMIT to tell the screens.
// Stock may go below zero: the sale happened, so the count was wrong and needs a recount.
export function applyRecipes(req, soldByMenuItem, note) {
  const changed = new Map(); // inventory id -> stock before the first change
  const recipe = db.prepare(
    `SELECT r.qty, i.* FROM menu_recipes r JOIN inventory_items i ON i.id = r.inventory_item_id
      WHERE r.menu_item_id = ? AND i.active = 1`
  );
  const update = db.prepare('UPDATE inventory_items SET quantity = ?, updated_at = ?, updated_by = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const [menuItemId, sold] of soldByMenuItem) {
    if (!sold) continue;
    for (const row of recipe.all(menuItemId)) {
      const { qty: perItem, ...item } = row;
      if (!changed.has(item.id)) changed.set(item.id, item);
      const change = -perItem * sold;
      const quantity = roundQty(item.quantity + change);
      update.run(quantity, now, req.staff?.name ?? ROLE_LABEL[req.role], item.id);
      logStock(req, { ...item, quantity }, sold > 0 ? 'sold' : 'returned', change, note);
    }
  }
  return () => {
    for (const [id, before] of changed) announceStock(req, before, db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id));
  };
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

// Owner: what each menu item takes out of stock.
app.get('/api/admin/recipes', (req, res) => {
  res.json(db.prepare(
    `SELECT r.menu_item_id, r.inventory_item_id, r.qty, i.name, i.unit
       FROM menu_recipes r JOIN inventory_items i ON i.id = r.inventory_item_id
      WHERE i.active = 1 ORDER BY lower(i.name)`
  ).all());
});

// Owner: replace one menu item's recipe. An empty list means selling it no longer touches stock.
app.put('/api/admin/recipes/:menuItemId', (req, res) => {
  const menuItem = db.prepare("SELECT * FROM menu_items WHERE id = ? AND active = 1 AND status = 'approved'").get(Number(req.params.menuItemId));
  if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });
  const { ingredients } = req.body ?? {};
  if (!Array.isArray(ingredients)) return res.status(400).json({ error: 'ingredients must be a list' });
  const rows = new Map();
  for (const { inventoryItemId, qty } of ingredients) {
    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ? AND active = 1').get(Number(inventoryItemId));
    if (!item) return res.status(400).json({ error: 'Stock item not found' });
    if (!isQty(qty) || qty === 0) return res.status(400).json({ error: `Enter how much ${item.name} one ${menuItem.name} uses` });
    rows.set(item.id, { item, qty: roundQty(qty) });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM menu_recipes WHERE menu_item_id = ?').run(menuItem.id);
    const insert = db.prepare('INSERT INTO menu_recipes (menu_item_id, inventory_item_id, qty) VALUES (?, ?, ?)');
    for (const { item, qty } of rows.values()) insert.run(menuItem.id, item.id, qty);
    const uses = [...rows.values()].map(({ item, qty }) => qtyText(item, qty) + ' ' + item.name).join(', ');
    logActivity(req, 'menu.recipe', `${menuItem.name} now uses ${uses || 'nothing from stock'}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  storeBroadcast('admin').emit('inventory.updated', {});
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
