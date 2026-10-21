import { requireRole } from '../auth/sessions.js';
import { db } from '../core/db.js';
import { dayRange } from '../core/dates.js';
import { attachItems, loadOrder } from '../sales/orders.js';
import { app, storeBroadcast } from '../core/http.js';

// ---------- Kitchen ----------

// Kitchen display: today's tickets not yet finished, oldest first. Tickets left open on earlier days
// aren't shown, so forgotten ones never push today's orders off the screen.
app.get('/api/kitchen/tickets', (req, res) => {
  const [from] = dayRange();
  const open = db
    .prepare("SELECT * FROM orders WHERE kitchen_status IN ('new', 'preparing') AND status = 'paid' AND created_at >= ? ORDER BY id")
    .all(from);
  res.json(attachItems(open));
});

// Kitchen -> server: move a ticket along (new -> preparing -> ready).
app.patch('/api/orders/:id/kitchen', requireRole('kitchen'), (req, res) => {
  const { status } = req.body ?? {};
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const now = new Date().toISOString();
  if (status === 'preparing' && order.kitchen_status === 'new') {
    // "Start all": every item on the ticket starts cooking.
    db.prepare("UPDATE orders SET kitchen_status = 'preparing', kitchen_started_at = ? WHERE id = ?").run(now, order.id);
    db.prepare('UPDATE order_items SET kitchen_started_at = COALESCE(kitchen_started_at, ?) WHERE order_id = ? AND sends_to_kitchen = 1').run(now, order.id);
  } else if (status === 'ready' && ['new', 'preparing'].includes(order.kitchen_status)) {
    db.prepare(
      "UPDATE orders SET kitchen_status = 'ready', kitchen_started_at = COALESCE(kitchen_started_at, ?), kitchen_ready_at = ? WHERE id = ?"
    ).run(now, now, order.id);
    db.prepare('UPDATE order_items SET kitchen_started_at = COALESCE(kitchen_started_at, ?), kitchen_ready_at = COALESCE(kitchen_ready_at, ?) WHERE order_id = ? AND sends_to_kitchen = 1').run(now, now, order.id);
  } else {
    return res.status(409).json({ error: `Cannot move ticket from ${order.kitchen_status} to ${status}` });
  }

  const updated = loadOrder(order.id);
  storeBroadcast(['kitchen', 'admin']).emit('ticket.updated', updated);
  res.json(updated);
});

// Kitchen -> server: move one item along: waiting -> cooking -> ready (or back, if tapped by mistake).
// Body { state: 'waiting' | 'cooking' | 'ready' }; the older { ready: true/false } still works.
// The ticket counts as started once any item is, and is finished when the last item is ready.
app.patch('/api/orders/:id/items/:itemId/kitchen', requireRole('kitchen'), (req, res) => {
  const state = typeof req.body?.ready === 'boolean' ? (req.body.ready ? 'ready' : 'waiting') : req.body?.state;
  if (!['waiting', 'cooking', 'ready'].includes(state)) return res.status(400).json({ error: 'state must be waiting, cooking or ready' });
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'paid'").get(Number(req.params.id));
  if (!order || !['new', 'preparing'].includes(order.kitchen_status)) return res.status(409).json({ error: 'This ticket is no longer open' });
  const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ? AND sends_to_kitchen = 1').get(Number(req.params.itemId), order.id);
  if (!item) return res.status(404).json({ error: 'Item not found on this ticket' });

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const started = state === 'waiting' ? null : item.kitchen_started_at ?? now;
    db.prepare('UPDATE order_items SET kitchen_started_at = ?, kitchen_ready_at = ? WHERE id = ?').run(started, state === 'ready' ? now : null, item.id);
    const counts = db.prepare(
      `SELECT SUM(kitchen_ready_at IS NULL) AS waiting, SUM(kitchen_started_at IS NOT NULL OR kitchen_ready_at IS NOT NULL) AS touched
         FROM order_items WHERE order_id = ? AND sends_to_kitchen = 1`
    ).get(order.id);
    if (!counts.waiting) {
      db.prepare("UPDATE orders SET kitchen_status = 'ready', kitchen_started_at = COALESCE(kitchen_started_at, ?), kitchen_ready_at = ? WHERE id = ?").run(now, now, order.id);
    } else if (counts.touched) {
      db.prepare("UPDATE orders SET kitchen_status = 'preparing', kitchen_started_at = COALESCE(kitchen_started_at, ?) WHERE id = ?").run(now, order.id);
    } else {
      db.prepare("UPDATE orders SET kitchen_status = 'new', kitchen_started_at = NULL WHERE id = ?").run(order.id);
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
