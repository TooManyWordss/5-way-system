// Shared by the server and offline POS. Money is always integer centavos.
export class DiningError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status = 400) => { throw new DiningError(message, status); };
export const emptyDining = () => ({ tables: {}, visits: {}, counterOrders: {} });
export const clone = (value) => structuredClone(value);
export function text(value, label, max = 200, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`Enter ${label} (up to ${max} characters)`);
  return value.trim();
}
export function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`Invalid ${label}`);
  return value;
}
export function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('Invalid timestamp');
  return new Date(value).toISOString();
}
export const linesOf = (visit) => visit.submissions.flatMap(s => s.lines);
export function totals(visit, taxRate = 0) {
  const subtotal_cents = linesOf(visit).reduce((sum, line) => sum + line.qty * line.unit_price_cents, 0);
  integer(subtotal_cents, 'subtotal');
  const discount = visit.discount;
  let discount_cents = 0;
  if (discount) {
    text(discount.reason, 'discount reason');
    if (!['', 'PWD', 'Senior'].includes(discount.label)) fail('Invalid discount label');
    if (discount.kind === 'percent') discount_cents = Math.round(subtotal_cents * integer(discount.value, 'discount basis points', 0, 10000) / 10000);
    else if (discount.kind === 'fixed') discount_cents = integer(discount.value, 'discount amount', 0, subtotal_cents);
    else fail('Choose a percentage or fixed discount');
  }
  const tax_cents = Math.round((subtotal_cents - discount_cents) * taxRate);
  const total_cents = subtotal_cents - discount_cents + tax_cents;
  integer(total_cents, 'total');
  return { subtotal_cents, discount_cents, tax_cents, total_cents };
}
export function ticketState(submission) {
  if (submission.cancelled_at) return 'cancelled';
  const lines = submission.lines.filter(l => l.sends_to_kitchen && l.qty > 0);
  if (!lines.length) return 'cancelled';
  if (lines.every(l => l.ready_qty === l.qty)) return 'ready';
  return submission.started_at ? 'preparing' : 'new';
}
function validateTimes(visit) {
  const events = ['arrived_at', 'first_order_at', 'eating_started_at', 'eating_finished_at', 'bill_requested_at', 'settled_at', 'released_at'];
  let previous = '';
  for (const key of events) if (visit[key]) {
    const time = timestamp(visit[key]);
    if (previous && time < previous) fail('Service timestamps must be in chronological order');
    previous = time;
  }
}
function version(record, expected) {
  if (!record) fail('Record not found', 404);
  if (record.version !== expected) fail('This record changed on another device. Review the current version before retrying.', 409);
}
function allowed(role, roles) { if (role !== 'admin' && !roles.includes(role)) fail('This action requires a different role', 403); }

// Returns a new state; never mutates the input, including when validation fails.
export function applyDining(input, operation, context) {
  const state = clone(input), { type, targetId, expectedVersion, payload: p = {} } = operation;
  const at = timestamp(operation.at), role = context.role;
  text(targetId, 'record ID', 100);
  if (Date.parse(at) > Date.now() + 300000) fail('Device time is in the future');
  if (type === 'counter.kitchen') {
    allowed(role, ['kitchen']);
    const order = state.counterOrders?.[targetId];
    version(order, expectedVersion);
    if (order.status !== 'paid' || order.visit_id || !['new', 'preparing', 'ready'].includes(order.kitchen_status)) fail('This ticket is no longer active', 409);
    if (p.lineId != null) {
      const line = order.items.find(l => l.id === p.lineId && l.sends_to_kitchen);
      if (!line) fail('Kitchen line not found', 404);
      line.ready_qty = integer(p.ready_qty, 'ready quantity', 0, line.qty);
    } else if (p.status === 'ready') order.items.forEach(l => { if (l.sends_to_kitchen) l.ready_qty = l.qty; });
    else if (p.status !== 'preparing') fail('Unknown kitchen status');
    order.kitchen_started_at ??= at;
    order.kitchen_status = order.items.filter(l => l.sends_to_kitchen).every(l => l.ready_qty === l.qty) ? 'ready' : 'preparing';
    order.kitchen_ready_at = order.kitchen_status === 'ready' ? order.kitchen_ready_at ?? at : null;
    order.version++;
    return state;
  }
  if (type.startsWith('table.')) {
    allowed(role, ['pos']);
    let table = state.tables[targetId];
    if (type === 'table.save') {
      allowed(role, []);
      if (table) version(table, expectedVersion); else if (expectedVersion !== 0) fail('Table no longer exists', 409);
      const name = text(p.name, 'table name', 60);
      if (Object.values(state.tables).some(t => t.id !== targetId && t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Table names must be unique', 409);
      if (typeof p.active !== 'boolean') fail('Choose active or inactive');
      if (table?.visit_id && !p.active) fail('Release this table before making it inactive', 409);
      state.tables[targetId] = { id: targetId, name, active: p.active, visit_id: table?.visit_id ?? null, version: (table?.version ?? 0) + 1 };
    } else if (type === 'table.seat') {
      version(table, expectedVersion);
      if (!table.active || table.visit_id) fail('This table is occupied or inactive. Choose another table.', 409);
      const id = text(p.visitId, 'visit ID', 100);
      if (state.visits[id]) fail('Visit ID already exists', 409);
      state.visits[id] = { id, table_id: targetId, table_name: table.name, version: 1, status: 'open', guests: integer(p.guests, 'guest count', 1, 999), alias: text(p.alias, 'guest alias', 80, true), vip: !!p.vip, repeat: !!p.repeat, arrived_at: timestamp(p.arrived_at ?? at), first_order_at: null, eating_started_at: null, eating_finished_at: null, bill_requested_at: null, settled_at: null, released_at: null, submissions: [], discount: null, feedback: '', receipt_id: null };
      table.visit_id = id; table.version++;
      validateTimes(state.visits[id]);
    } else fail('Unknown table action');
    return state;
  }
  allowed(role, type.startsWith('kitchen.') ? ['kitchen'] : ['pos']);
  const visit = state.visits[targetId];
  version(visit, expectedVersion);
  const editable = () => { if (visit.status !== 'open') fail('This visit is no longer open', 409); };
  if (type === 'visit.details') {
    editable();
    visit.guests = integer(p.guests, 'guest count', 1, 999);
    visit.alias = text(p.alias, 'guest alias', 80, true); visit.vip = !!p.vip; visit.repeat = !!p.repeat;
  } else if (type === 'visit.submit') {
    editable();
    if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 200) fail('Add at least one item (up to 200 lines)');
    const submissionId = text(p.submissionId, 'submission ID', 100);
    if (Object.values(state.visits).some(v => v.submissions.some(s => s.id === submissionId))) fail('Submission ID already exists', 409);
    const seen = new Set(linesOf(visit).map(l => l.id));
    const lines = p.lines.map(l => {
      if (!l || typeof l !== 'object' || Array.isArray(l)) fail('Invalid order line');
      const id = text(l.id, 'line ID', 100); if (seen.has(id)) fail('Duplicate line ID'); seen.add(id);
      const item = context.menu.find(m => m.id === l.menu_item_id && m.active !== 0 && m.status !== 'pending' && m.status !== 'rejected');
      if (!item) fail('A selected menu item no longer exists', 409);
      if (item.unavailable_since ? item.unavailable_since <= at : item.available === 0) fail(`${item.name} is unavailable`, 409);
      if (l.unit_price_cents !== item.price_cents || l.name !== item.name || Number(l.sends_to_kitchen) !== Number(item.sends_to_kitchen)) fail(`Menu details changed for ${item.name}. Review the current menu before retrying.`, 409);
      return { id, menu_item_id: item.id, name: item.name, unit_price_cents: item.price_cents, sends_to_kitchen: Number(item.sends_to_kitchen), qty: integer(l.qty, 'quantity', 1, 99), ready_qty: 0, note: text(l.note, 'preparation note', 300, true), changes: [] };
    });
    visit.submissions.push({ id: submissionId, submitted_at: at, started_at: null, ready_at: null, change_seq: 0, acknowledged_seq: 0, lines });
    if (!visit.first_order_at) visit.first_order_at = at;
  } else if (type === 'visit.line') {
    editable();
    const submission = visit.submissions.find(s => s.lines.some(l => l.id === p.lineId));
    const line = submission?.lines.find(l => l.id === p.lineId);
    if (!line) fail('Line not found', 404);
    const qty = integer(p.qty, 'quantity', 0, line.qty);
    // Extra quantities are separate submissions, preserving FIFO and readiness.
    const note = text(p.note, 'preparation note', 300, true);
    line.changes.push({ at, previous_qty: line.qty, qty, previous_note: line.note, note });
    line.qty = qty; line.note = note; line.ready_qty = Math.min(line.ready_qty, qty);
    submission.change_seq = (submission.change_seq ?? 0) + 1;
    submission.ready_at = ticketState(submission) === 'ready' ? submission.ready_at ?? at : null;
  } else if (type.startsWith('kitchen.')) {
    if (['cancelled', 'refunded'].includes(visit.status) && type !== 'kitchen.ack') fail('This visit was cancelled', 409);
    const submission = visit.submissions.find(s => s.id === p.submissionId);
    if (!submission) fail('Submission not found', 404);
    const previousState = ticketState(submission), previousReadyAt = submission.ready_at;
    if (type === 'kitchen.ack') { submission.acknowledged_seq = submission.change_seq ?? 0; }
    else if (ticketState(submission) === 'cancelled') fail('No kitchen items on this submission', 409);
    else if (type === 'kitchen.start') submission.started_at ??= at;
    else if (type === 'kitchen.ready') {
      submission.started_at ??= at;
      submission.lines.forEach(l => { if (l.sends_to_kitchen) l.ready_qty = l.qty; });
      submission.acknowledged_seq = submission.change_seq ?? 0;
    } else if (type === 'kitchen.line') {
      const line = submission.lines.find(l => l.id === p.lineId && l.sends_to_kitchen && l.qty);
      if (!line) fail('Kitchen line not found', 404);
      line.ready_qty = integer(p.ready_qty, 'ready quantity', 0, line.qty);
      submission.started_at ??= at;
    } else fail('Unknown kitchen action');
    if (at < submission.submitted_at) fail('Kitchen time precedes order time');
    if (submission.started_at && at < submission.started_at) fail('Kitchen time precedes preparation start');
    submission.ready_at = ticketState(submission) === 'ready' ? previousState === 'ready' ? previousReadyAt ?? at : at : null;
  } else if (type === 'visit.discount') {
    editable(); visit.discount = p.discount == null ? null : clone(p.discount);
  } else if (type === 'visit.feedback') {
    visit.feedback = text(p.feedback, 'feedback', 4000, true);
  } else if (type === 'visit.event') {
    editable();
    const preceding = { eating_started_at: 'first_order_at', eating_finished_at: 'eating_started_at', bill_requested_at: 'first_order_at' };
    if (!Object.hasOwn(preceding, p.event)) fail('Unknown service event');
    if (visit[p.event]) fail('This event is already recorded. Ask the owner to correct its timestamp.', 409);
    if (!visit[preceding[p.event]]) fail('Record the preceding service event first');
    visit[p.event] = at;
  } else if (type === 'visit.correct-time') {
    allowed(role, []);
    text(p.reason, 'correction reason');
    if (!['arrived_at', 'first_order_at', 'eating_started_at', 'eating_finished_at', 'bill_requested_at', 'settled_at', 'released_at'].includes(p.event) || !visit[p.event]) fail('Select an existing event to correct');
    visit[p.event] = timestamp(p.value);
  } else if (type === 'visit.settle') {
    editable();
    if (!linesOf(visit).some(l => l.qty > 0)) fail('Cannot settle an empty bill');
    if (!visit.bill_requested_at) fail('Request the bill before settlement');
    visit.bill = totals(visit, context.taxRate);
    integer(p.cash_cents, 'cash tendered', visit.bill.total_cents);
    // Detect an offline bill that no longer matches the authoritative total.
    if (p.total_cents !== visit.bill.total_cents) fail('Bill total changed. Review the recorded cash and current bill.', 409);
    visit.cash_cents = p.cash_cents; visit.change_cents = p.cash_cents - visit.bill.total_cents;
    visit.status = 'settled'; visit.settled_at = at;
  } else if (type === 'visit.cancel') {
    editable(); visit.cancel_reason = text(p.reason, 'cancellation reason'); visit.status = 'cancelled'; visit.cancelled_at = at;
    for (const s of visit.submissions) { s.cancelled_at = at; s.cancel_reason = visit.cancel_reason; s.change_seq = (s.change_seq ?? 0) + 1; }
  } else if (type === 'visit.release') {
    if (!['settled', 'cancelled', 'refunded'].includes(visit.status)) fail('Settle or cancel the visit before releasing the table', 409);
    const table = state.tables[visit.table_id];
    if (table.visit_id !== visit.id) fail('This table has already been released or reassigned', 409);
    visit.released_at = at; table.visit_id = null; table.version++;
  } else fail('Unknown visit action');
  totals(visit, context.taxRate);
  validateTimes(visit);
  visit.version++;
  return state;
}

export function diningMetrics(state, from, to) {
  const visits = Object.values(state.visits).filter(v => v.arrived_at >= from && v.arrived_at < to && !['cancelled', 'refunded'].includes(v.status));
  const paid = visits.filter(v => v.status === 'settled');
  const average = values => ({ count: values.length, average_minutes: values.length ? values.reduce((s, n) => s + n, 0) / values.length / 60000 : null });
  const duration = (a, b) => average(visits.filter(v => v[a] && v[b] && v[b] >= v[a]).map(v => Date.parse(v[b]) - Date.parse(v[a])));
  const guests = paid.reduce((s, v) => s + v.guests, 0);
  const net = paid.reduce((s, v) => s + v.bill.subtotal_cents - v.bill.discount_cents, 0);
  return { visits: visits.length, paid_visits: paid.length, guests_served: guests, net_sales_cents: net, average_spend_cents: guests ? Math.round(net / guests) : null,
    preparation: average(visits.flatMap(v => v.submissions.filter(s => s.ready_at && ticketState(s) === 'ready').map(s => Date.parse(s.ready_at) - Date.parse(s.submitted_at)))),
    arrival_to_order: duration('arrived_at', 'first_order_at'), eating: duration('eating_started_at', 'eating_finished_at'), bill_to_payment: duration('bill_requested_at', 'settled_at'), occupancy: duration('arrived_at', 'released_at') };
}
