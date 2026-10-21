import { menuCatalog } from '../../menu-catalog.js';
import { receiptForStore, TAX_RATE } from '../core/config.js';
import { stationOf } from '../auth/sessions.js';
import { money } from '../core/dates.js';
import { db } from '../core/db.js';
import { logActivity } from '../sales/orders.js';
import { app, storeBroadcast } from '../core/http.js';

// ---------- Menu ----------

export const catalogDetails = new Map(menuCatalog.map(item => [`${item.category}|${item.name}`, {
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
export function menuItemProblem({ name, category, priceCents }, ignoreId = 0) {
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
