import { requireRole } from '../auth/sessions.js';
import { db } from '../core/db.js';
import { attachItems, loadOrder } from '../sales/orders.js';
import { app, storeBroadcast } from '../core/http.js';

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
    db.prepare('UPDATE order_items SET kitchen_ready_at = COALESCE(kitchen_ready_at, ?) WHERE order_id = ? AND sends_to_kitchen = 1').run(now, order.id);
  } else {
    return res.status(409).json({ error: `Cannot move ticket from ${order.kitchen_status} to ${status}` });
  }

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin']).emit('ticket.updated', updated);
  res.json(updated);
});

// Kitchen -> server: one item on a ticket is ready (or tapped again: not ready after all).
// The ticket starts when the first item is ready and is finished when the last one is.
app.patch('/api/orders/:id/items/:itemId/kitchen', requireRole('kitchen'), (req, res) => {
  const { ready } = req.body ?? {};
  if (typeof ready !== 'boolean') return res.status(400).json({ error: 'ready must be true or false' });
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'paid'").get(Number(req.params.id));
  if (!order || !['new', 'preparing'].includes(order.kitchen_status)) return res.status(409).json({ error: 'This ticket is no longer open' });
  const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ? AND sends_to_kitchen = 1').get(Number(req.params.itemId), order.id);
  if (!item) return res.status(404).json({ error: 'Item not found on this ticket' });

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE order_items SET kitchen_ready_at = ? WHERE id = ?').run(ready ? now : null, item.id);
    const waiting = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND sends_to_kitchen = 1 AND kitchen_ready_at IS NULL').get(order.id).n;
    if (waiting === 0) {
      db.prepare("UPDATE orders SET kitchen_status = 'ready', kitchen_started_at = COALESCE(kitchen_started_at, ?), kitchen_ready_at = ? WHERE id = ?").run(now, now, order.id);
    } else if (ready && order.kitchen_status === 'new') {
      db.prepare("UPDATE orders SET kitchen_status = 'preparing', kitchen_started_at = ? WHERE id = ?").run(now, order.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin']).emit('ticket.updated', updated);
  res.json(updated);
});
