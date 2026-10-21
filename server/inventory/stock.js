import { STOCK_KEEPERS } from '../core/config.js';
import { db } from '../core/db.js';
import { logActivity } from '../sales/orders.js';
import { storeBroadcast } from '../core/http.js';
const ROLE_LABEL = { pos: 'Cashier', barista: 'Barista', kitchen: 'Kitchen', inventory: 'Inventory', admin: 'Owner' };

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
