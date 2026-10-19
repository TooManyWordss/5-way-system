import { receiptLabel } from '../auth/sessions.js';
import { dayRange, localDate } from '../core/dates.js';
import { db } from '../core/db.js';

export function attachItems(orders) {
  if (orders.length === 0) return orders;
  const ids = orders.map((o) => o.id);
  const items = db
    .prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);
  const byOrder = new Map(orders.map((o) => [o.id, { ...o, receipt_label: receiptLabel(o), items: [] }]));
  for (const item of items) byOrder.get(item.order_id).items.push(item);
  return [...byOrder.values()];
}

export function loadOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return order ? attachItems([order])[0] : null;
}

// `req` names who did it: the role, plus the staff member's name when they signed in as themselves.
export function logActivity(req, action, message, orderId = null) {
  const now = new Date();
  db.prepare(
    'INSERT INTO activity_log (at, business_date, actor, actor_name, action, order_id, message) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(now.toISOString(), localDate(now), req.role, req.staff?.name ?? null, action, orderId, message);
}

// Everything that happened on one local day. Voided receipts are listed but not counted as sales.
// With a station, only that till's receipts (the cashier and barista each see their own).
export function dayReport(date = localDate(), station = null) {
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
export function saleTime(createdAt) {
  const now = Date.now();
  const time = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(time) || time > now + 5 * 60_000 || time < now - 2 * 86_400_000) {
    return new Date(now).toISOString();
  }
  return new Date(time).toISOString();
}
