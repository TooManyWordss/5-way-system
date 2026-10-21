import { db } from '../core/db.js';
import { attachItems } from '../sales/orders.js';

// Floor-plan receipts are already paid. Group repeat orders for the same seating
// into one visit, without pretending that missing service timestamps were recorded.
export function floorMetricsVisits() {
  const orders = attachItems(db.prepare("SELECT * FROM orders WHERE table_id IS NOT NULL AND visit_id IS NULL AND status = 'paid' ORDER BY created_at, id").all());
  const visits = new Map();
  for (const order of orders) {
    const key = 'floor:' + order.table_id + ':' + (order.seated_at ?? order.id);
    let visit = visits.get(key);
    if (!visit) {
      visit = { id: key, status: 'settled', arrived_at: order.seated_at ?? order.created_at, first_order_at: order.created_at, settled_at: order.created_at, released_at: order.billed_out_at, guests: order.guests ?? 1, bill: { subtotal_cents: 0, discount_cents: 0 }, submissions: [] };
      visits.set(key, visit);
    }
    visit.guests = Math.max(visit.guests, order.guests ?? 1);
    visit.settled_at = order.created_at;
    visit.released_at = order.billed_out_at;
    visit.bill.subtotal_cents += order.subtotal_cents;
    visit.bill.discount_cents += order.discount_cents ?? 0;
    visit.submissions.push({ submitted_at: order.created_at, ready_at: order.kitchen_ready_at, lines: order.items });
  }
  return [...visits.values()];
}
