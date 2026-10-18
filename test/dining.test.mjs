import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyDining, emptyDining, totals, ticketState, diningMetrics } from '../dining-domain.js';

import { launch } from './support/server.mjs';
const id = () => crypto.randomUUID();

test('table lifecycle, offline conflicts, readiness, refunds, and business undo', async t => {
  const server = await launch();
  try {
    const { request, login } = server, owner = await login('admin'), pos = await login('pos'), kitchen = await login('kitchen'), inventory = await login('inventory'), barista = await login('barista');
    const snapshot = async () => (await request('/api/dining/state', owner)).data;
    let clock = Date.now() - 3600000;
    const envelope = (type, targetId, expectedVersion, payload, deviceId = 'pos-A') => ({ id: id(), deviceId, at: new Date(clock += 1000).toISOString(), type, targetId, expectedVersion, payload });
    const sync = async (operations, who = pos) => request('/api/dining/sync', who, { operations });
    const act = async (type, target, payload, who = pos) => {
      const state = await snapshot(), record = type === 'counter.kitchen' ? state.counterOrders[target] : type.startsWith('table.') ? state.tables[target] : state.visits[target];
      const op = envelope(type, target, record?.version ?? 0, payload);
      const result = await sync([op], who);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal(result.data.results[0].status, 'applied', JSON.stringify(result.data));
      return { op, result: result.data.results[0] };
    };
    let table = id(), visit = id(), submission = id(), firstLine = id(), item, settlement;
    await t.test('authorization and store boundary', async () => {
      assert.equal((await request('/api/dining/state')).status, 401);
      assert.equal((await request('/api/dining/state', inventory)).status, 401);
      assert.equal((await request('/rairock/api/dining/state', owner)).status, 404);
      assert.equal((await sync([envelope('table.save', table, 0, { name: 'Garden', active: true })])).status, 403);
      assert.equal((await request('/api/dining/metrics?from=2026-01-01&to=2026-12-31', pos)).status, 401);
    });
    await t.test('named table, unpaid submissions, price snapshots, and stable line identity', async () => {
      await act('table.save', table, { name: 'Garden', active: true }, owner);
      const duplicate = await act('table.save', id(), { name: 'Patio', active: true }, owner);
      const dup = await sync([envelope('table.save', id(), 0, { name: 'garden', active: true })], owner);
      assert.equal(dup.data.results[0].status, 'conflict');
      await act('table.seat', table, { visitId: visit, guests: 3, alias: 'Alex', vip: true, repeat: true });
      const release = await sync([envelope('visit.release', visit, 1, {})]);
      assert.equal(release.data.results[0].status, 'conflict');
      item = (await snapshot()).menu.find(m => m.sends_to_kitchen && m.available);
      await act('visit.submit', visit, { submissionId: submission, lines: [{ id: firstLine, menu_item_id: item.id, name: item.name, unit_price_cents: item.price_cents, sends_to_kitchen: item.sends_to_kitchen, qty: 3, note: 'No onions' }] });
      assert.equal((await request('/api/admin/day', owner)).data.summary.order_count, 0);
      const menuEdit = await request(`/api/dining/menu/${item.id}`, owner, { expectedVersion: item.version, name: `${item.name} revised`, category: item.category, price_cents: item.price_cents + 100, sends_to_kitchen: true, available: true }, 'PATCH');
      assert.equal(menuEdit.status, 200);
      const v = (await snapshot()).visits[visit];
      assert.equal(v.submissions[0].lines[0].unit_price_cents, item.price_cents);
      assert.equal(v.submissions[0].lines[0].name, item.name);
      assert.equal(v.submissions[0].lines[0].id, firstLine);
      assert.equal(duplicate.result.status, 'applied');
    });
    await t.test('partial readiness, quantity cancellation, extra submission, FIFO timestamps', async () => {
      await act('kitchen.line', visit, { submissionId: submission, lineId: firstLine, ready_qty: 1 }, kitchen);
      let state = await snapshot(), v = state.visits[visit], originalTime = v.submissions[0].submitted_at;
      assert.equal(ticketState(v.submissions[0]), 'preparing');
      await act('visit.line', visit, { lineId: firstLine, qty: 2, note: 'No onions; sauce aside' });
      state = await snapshot(); v = state.visits[visit];
      assert.equal(v.submissions[0].submitted_at, originalTime);
      assert.equal(v.submissions[0].lines[0].changes[0].previous_qty, 3);
      await act('kitchen.ready', visit, { submissionId: submission }, kitchen);
      assert.equal(ticketState((await snapshot()).visits[visit].submissions[0]), 'ready');
      const current = (await snapshot()).menu.find(m => m.id === item.id);
      await act('visit.submit', visit, { submissionId: id(), lines: [{ id: id(), menu_item_id: current.id, name: current.name, unit_price_cents: current.price_cents, sends_to_kitchen: current.sends_to_kitchen, qty: 1, note: '' }] });
      v = (await snapshot()).visits[visit];
      assert.equal(v.first_order_at, originalTime);
      assert.ok(v.submissions[1].submitted_at > originalTime);
      assert.equal(ticketState(v.submissions[1]), 'new');
    });
    await t.test('manual discounts, explicit events, one receipt, idempotent retry', async () => {
      await act('visit.discount', visit, { discount: { kind: 'percent', value: 2000, reason: 'Owner-approved concession', label: 'PWD' } });
      await act('visit.event', visit, { event: 'eating_started_at' });
      await act('visit.event', visit, { event: 'eating_finished_at' });
      await act('visit.event', visit, { event: 'bill_requested_at' });
      const v = (await snapshot()).visits[visit], bill = totals(v, 0.12);
      assert.equal(bill.discount_cents, Math.round(bill.subtotal_cents * 0.2));
      assert.equal(bill.tax_cents, Math.round((bill.subtotal_cents - bill.discount_cents) * 0.12));
      settlement = await act('visit.settle', visit, { cash_cents: bill.total_cents + 1000, total_cents: bill.total_cents });
      assert.ok(settlement.result.result.receipt.id);
      const revision = (await snapshot()).revision;
      const replay = await sync([settlement.op]);
      assert.equal(replay.data.results[0].result.receipt.id, settlement.result.result.receipt.id);
      assert.equal((await snapshot()).revision, revision);
      assert.equal((await request('/api/admin/day', owner)).data.summary.order_count, 1);
      assert.equal((await request(`/api/orders/${settlement.result.result.receipt.id}/void`, pos, { reason: 'Bypass' })).status, 409);
      const competing = await sync([{ ...settlement.op, id: id(), deviceId: 'pos-B' }]);
      assert.equal(competing.data.results[0].status, 'conflict');
      assert.equal((await request('/api/admin/day', owner)).data.summary.order_count, 1);
    });
    await t.test('dashboard daily series reconciles with totals and compares equal date windows', async () => {
      const v = (await snapshot()).visits[visit];
      const day = new Date(Date.parse(v.arrived_at) + 8 * 3600000).toISOString().slice(0, 10);
      const previousDay = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const result = await request(`/api/dining/metrics?from=${day}&to=${day}`, owner);
      assert.equal(result.status, 200);
      assert.equal(result.data.daily.length, 1);
      assert.equal(result.data.daily[0].date, day);
      assert.equal(result.data.guests_served, 3);
      assert.equal(result.data.daily[0].net_sales_cents, v.bill.subtotal_cents - v.bill.discount_cents);
      assert.equal(result.data.daily[0].net_sales_cents, result.data.net_sales_cents);
      assert.equal(result.data.previousFrom, previousDay);
      assert.equal(result.data.previousTo, previousDay);
      assert.equal(result.data.previous.guests_served, 0);
      assert.equal((await request('/api/dining/metrics?from=2020-01-01&to=2026-12-31', owner)).status, 400);
    });
    await t.test('dependency-blocked undo, owner corrections, refund audit, and occupancy', async () => {
      const feedback = await act('visit.feedback', visit, { feedback: 'Guests loved the garden seating.' });
      assert.equal((await request(`/api/dining/undo/${settlement.op.id}`, pos, {})).status, 409);
      assert.equal((await request(`/api/dining/undo/${feedback.op.id}`, kitchen, {})).status, 403);
      assert.equal((await request(`/api/dining/undo/${feedback.op.id}`, pos, {})).status, 200);
      // Later feedback was reversed, so the original settlement can now be reversed safely.
      const reversed = await request(`/api/dining/undo/${settlement.op.id}`, pos, {});
      assert.equal(reversed.status, 200, JSON.stringify(reversed.data));
      assert.equal(reversed.data.refund_cents, settlement.result.result.receipt.total_cents);
      assert.equal((await request('/api/admin/day', owner)).data.summary.order_count, 0);
      await act('visit.release', visit, {});
      assert.equal((await snapshot()).tables[table].visit_id, null);
      const undo = await request(`/api/dining/undo/${settlement.op.id}`, pos, {});
      assert.equal(undo.status, 409);
    });
    await t.test('two offline devices competing for a table retain both parties and dependencies', async () => {
      const state = await snapshot(), version = state.tables[table].version, visitA = id(), visitB = id();
      const a = envelope('table.seat', table, version, { visitId: visitA, guests: 2, alias: 'Device A' });
      const b = envelope('table.seat', table, version, { visitId: visitB, guests: 4, alias: 'Device B' }, 'pos-B');
      assert.equal((await sync([a])).data.results[0].status, 'applied');
      assert.equal((await sync([b])).data.results[0].status, 'conflict');
      const later = envelope('visit.feedback', visitB, 1, { feedback: 'Saved offline after seating' }, 'pos-B'); later.dependsOn = b.id;
      assert.equal((await sync([later])).data.results[0].status, 'conflict');
      const other = Object.values((await snapshot()).tables).find(t => !t.visit_id && t.active);
      const replacement = { ...b, id: id(), targetId: other.id, expectedVersion: other.version };
      const resolution = await request(`/api/dining/conflicts/${b.id}/resolve`, owner, { action: 'retry', note: 'Moved device B party to Patio; no cash collected', cashCorrectionCents: 0, operation: replacement });
      assert.equal(resolution.status, 200, JSON.stringify(resolution.data));
      const retryLater = { ...later, id: id() };
      assert.equal((await sync([retryLater])).data.results[0].status, 'applied');
      assert.equal((await snapshot()).visits[visitB].feedback, 'Saved offline after seating');
      assert.equal((await snapshot()).visits[visitA].guests, 2);
      const original = (await request('/api/dining/history', owner)).data.find(r => r.id === b.id);
      assert.equal(original.operation.deviceId, 'pos-B');
      assert.equal(original.resolution.note, 'Moved device B party to Patio; no cash collected');
    });
    await t.test('counter kitchen readiness and compensating stock/sale undo', async () => {
      const current = (await snapshot()).menu.find(m => m.id === item.id);
      const sale = await request('/api/orders', pos, { clientId: id(), items: [{ menuItemId: current.id, qty: 2 }], cashTenderedCents: current.price_cents * 3 });
      assert.equal(sale.status, 201); assert.ok(sale.data.undoId);
      const order = sale.data;
      const ready = await act('counter.kitchen', String(order.id), { lineId: order.items[0].id, ready_qty: 1 }, kitchen);
      assert.equal((await snapshot()).counterOrders[order.id].items[0].ready_qty, 1);
      assert.equal((await request(`/api/dining/business-undo/${sale.data.undoId}`, pos, {})).status, 409);
      assert.equal((await request(`/api/dining/undo/${ready.op.id}`, kitchen, {})).status, 200);
      const voided = await request(`/api/dining/business-undo/${sale.data.undoId}`, pos, {});
      assert.equal(voided.status, 200, JSON.stringify(voided.data));
      assert.equal(voided.data.cash_correction_cents, -order.total_cents);
      const stock = await request('/api/inventory/items', inventory, { name: 'Beans', unit: 'kg', quantity: 10, threshold: 2 });
      assert.equal(stock.status, 201);
      const received = await request(`/api/inventory/${stock.data.id}/stock`, inventory, { kind: 'received', amount: 5 });
      const consumed = await request(`/api/inventory/${stock.data.id}/stock`, inventory, { kind: 'used', amount: 1 });
      assert.equal((await request(`/api/dining/business-undo/${received.data.undoId}`, inventory, {})).status, 409);
      assert.equal((await request(`/api/dining/business-undo/${consumed.data.undoId}`, inventory, {})).status, 200);
      assert.equal((await request('/api/inventory', inventory)).data[0].quantity, 15);
      const log = (await request('/api/admin/inventory', owner)).data.log;
      assert.equal(log[0].kind, 'undo'); assert.equal(log[0].change, 1);
      assert.equal((await request(`/api/dining/business-undo/${consumed.data.undoId}`, inventory, {})).status, 409);
      assert.equal((await request(`/api/dining/business-undo/${received.data.undoId}`, inventory, {})).status, 200);
      assert.equal((await request('/api/inventory', inventory)).data[0].quantity, 10);
      const b = await request('/api/orders', barista, { clientId: id(), station: 'barista', items: [{ menuItemId: current.id, qty: 1 }], cashTenderedCents: current.price_cents * 2 });
      assert.match(b.data.receipt_label, /^B-/);
      assert.equal((await request(`/api/dining/business-undo/${b.data.undoId}`, barista, {})).status, 200);
    });
    await t.test('counter discounts, stable receipt lines, discount-only edits, and chained undo', async () => {
      const current = (await snapshot()).menu.find(m => m.id === item.id);
      const sale = await request('/api/orders', pos, { clientId: id(), items: [{ menuItemId: current.id, qty: 2 }], cashTenderedCents: current.price_cents * 3, discount: { kind: 'percent', value: 1000, reason: 'Manual senior concession', label: 'Senior' } });
      assert.equal(sale.status, 201);
      assert.equal(sale.data.discount_cents, Math.round(current.price_cents * 0.2));
      assert.equal(sale.data.tax_cents, Math.round((sale.data.subtotal_cents - sale.data.discount_cents) * 0.12));
      const changed = await request(`/api/orders/${sale.data.id}`, pos, { expectedVersion: sale.data.version, items: [{ menuItemId: current.id, qty: 2 }], discount: { kind: 'fixed', value: 500, reason: 'Changed concession', label: '' } }, 'PATCH');
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      assert.equal(changed.data.order.items[0].id, sale.data.items[0].id);
      assert.equal(changed.data.order.discount_cents, 500);
      assert.equal((await request(`/api/dining/business-undo/${changed.data.undoId}`, pos, {})).status, 200);
      const afterUndo = (await request('/api/pos/today', pos)).data.orders.find(o => o.id === sale.data.id);
      assert.equal(afterUndo.discount_cents, sale.data.discount_cents);
      assert.ok(afterUndo.version > changed.data.order.version);
      assert.equal((await request(`/api/dining/business-undo/${sale.data.undoId}`, pos, {})).status, 200);
      const invalid = await request('/api/orders', pos, { clientId: id(), items: [{ menuItemId: current.id, qty: 1 }], discount: { kind: 'percent', value: 10001, reason: 'Invalid', label: '' } });
      assert.equal(invalid.status, 400);
      // A failed legacy write must release its savepoint and leave the server usable.
      assert.equal((await request('/api/dining/state', owner)).status, 200);
    });
    await t.test('owner timestamp corrections and kitchen cancellation acknowledgement', async () => {
      const previous = (await snapshot()).visits[visit].arrived_at;
      const correction = { event: 'arrived_at', value: new Date(Date.parse(previous) - 60000).toISOString(), reason: 'Corrected seating entry' };
      const badRole = await sync([envelope('visit.correct-time', visit, (await snapshot()).visits[visit].version, correction)]);
      assert.equal(badRole.status, 403);
      const corrected = await act('visit.correct-time', visit, correction, owner);
      assert.equal((await snapshot()).visits[visit].arrived_at, correction.value);
      assert.equal((await request(`/api/dining/undo/${corrected.op.id}`, owner, {})).status, 200);
      assert.equal((await snapshot()).visits[visit].arrived_at, previous);
      const cancelTable = id(), cancelVisit = id(), s = id(), current = (await snapshot()).menu.find(m => m.id === item.id);
      await act('table.save', cancelTable, { name: 'Cancellation test', active: true }, owner);
      await act('table.seat', cancelTable, { visitId: cancelVisit, guests: 1 });
      await act('visit.submit', cancelVisit, { submissionId: s, lines: [{ id: id(), menu_item_id: current.id, name: current.name, unit_price_cents: current.price_cents, sends_to_kitchen: current.sends_to_kitchen, qty: 1, note: '' }] });
      await act('visit.cancel', cancelVisit, { reason: 'Party left before preparation' });
      let submission = (await snapshot()).visits[cancelVisit].submissions[0];
      assert.equal(ticketState(submission), 'cancelled');
      assert.ok(submission.change_seq > submission.acknowledged_seq);
      await act('kitchen.ack', cancelVisit, { submissionId: s }, kitchen);
      submission = (await snapshot()).visits[cancelVisit].submissions[0];
      assert.equal(submission.change_seq, submission.acknowledged_seq);
      await act('visit.release', cancelVisit, {});
    });
    await t.test('menu proposals, approvals, custom events, and visibility retain undo history', async () => {
      const proposed = await request('/api/menu/requests', pos, { name: 'Test pastry', category: 'Test menu', priceCents: 12000, sendsToKitchen: false });
      assert.equal(proposed.status, 201); assert.ok(proposed.data.undoId);
      const approved = await request(`/api/admin/menu-requests/${proposed.data.id}`, owner, { decision: 'approve' });
      assert.equal(approved.status, 200); assert.ok(approved.data.undoId);
      assert.equal((await request(`/api/dining/business-undo/${proposed.data.undoId}`, pos, {})).status, 409);
      assert.equal((await request(`/api/dining/business-undo/${approved.data.undoId}`, owner, {})).status, 200);
      assert.ok((await request('/api/admin/menu-requests', owner)).data.some(m => m.id === proposed.data.id));
      assert.equal((await request(`/api/dining/business-undo/${proposed.data.undoId}`, pos, {})).status, 200);
      assert.ok(!(await request('/api/admin/menu-requests', owner)).data.some(m => m.id === proposed.data.id));
      const created = await request('/api/admin/events', owner, { name: 'Test café event', start: '2026-10-18', end: '2026-10-18', kind: 'iligan', note: 'Test' });
      assert.equal(created.status, 201); assert.ok(created.data.undoId);
      const deleted = await request(`/api/admin/events/${created.data.id}`, owner, undefined, 'DELETE');
      assert.equal(deleted.status, 200); assert.ok(deleted.data.undoId);
      assert.equal((await request(`/api/dining/business-undo/${deleted.data.undoId}`, owner, {})).status, 200);
      assert.equal((await request(`/api/dining/business-undo/${created.data.undoId}`, owner, {})).status, 200);
      const hidden = await request('/api/admin/events/visibility', owner, { key: 'test-event', hidden: true });
      assert.ok(hidden.data.undoId);
      assert.equal((await request(`/api/dining/business-undo/${hidden.data.undoId}`, owner, {})).status, 200);
      const db = new DatabaseSync(path.join(server.dir, 'data.db'));
      try { assert.equal(db.prepare('SELECT active FROM events WHERE id = ?').get(created.data.id).active, 0); } finally { db.close(); }
    });
    await t.test('staff identities with the same display name cannot undo each other’s actions', async () => {
      const db = new DatabaseSync(path.join(server.dir, 'data.db'));
      let first, second;
      try {
        const insert = db.prepare("INSERT INTO staff (name, role, active, created_at) VALUES ('Same display name', 'inventory', 1, ?)");
        first = Number(insert.run(new Date().toISOString()).lastInsertRowid);
        second = Number(insert.run(new Date().toISOString()).lastInsertRowid);
      } finally { db.close(); }
      const cookie = staffId => {
        const value = `inventory.ambiente.${Date.now() + 3600000}.${staffId}`;
        return `session=${value}.${crypto.createHmac('sha256', 'dining-tests').update(value).digest('base64url')}`;
      };
      const stock = await request('/api/inventory/items', cookie(first), { name: 'Identity test', unit: 'pcs', quantity: 1, threshold: 0 });
      assert.equal(stock.status, 201);
      assert.equal((await request(`/api/dining/business-undo/${stock.data.undoId}`, cookie(second), {})).status, 403);
      assert.equal((await request(`/api/dining/business-undo/${stock.data.undoId}`, cookie(first), {})).status, 200);
    });
    await t.test('migration is additive and audit records remain after reversals', async () => {
      const database = new DatabaseSync(path.join(server.dir, 'data.db'));
      try {
        assert.ok(database.prepare('SELECT COUNT(*) AS n FROM dining_operations').get().n > 20);
        assert.ok(database.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'voided'").get().n >= 3);
        assert.ok(database.prepare('SELECT COUNT(*) AS n FROM order_items').get().n > 0);
      } finally { database.close(); }
    });
  } finally { await server.close(); }
});

test('domain validation is atomic and metrics count only complete non-refunded samples', () => {
  const state = emptyDining(), at = new Date(Date.now() - 86400000).toISOString();
  const table = { id: 't', name: 'One', active: true, visit_id: null, version: 1 };
  state.tables.t = table;
  const op = { id: 'seat', deviceId: 'test', type: 'table.seat', targetId: 't', expectedVersion: 1, at, payload: { visitId: 'v', guests: 2 } };
  const seated = applyDining(state, op, { role: 'pos', menu: [], taxRate: 0.12 });
  assert.equal(state.tables.t.visit_id, null);
  assert.throws(() => applyDining(seated, { ...op, id: 'again' }, { role: 'pos', menu: [], taxRate: 0.12 }), /changed/);
  const visit = seated.visits.v;
  visit.status = 'settled'; visit.bill = { subtotal_cents: 10000, discount_cents: 2000 }; visit.settled_at = at;
  visit.first_order_at = new Date(Date.parse(at) + 60000).toISOString();
  let metrics = diningMetrics(seated, '2000', '2100');
  assert.equal(metrics.guests_served, 2); assert.equal(metrics.net_sales_cents, 8000); assert.equal(metrics.average_spend_cents, 4000);
  assert.equal(metrics.arrival_to_order.count, 1); assert.equal(metrics.arrival_to_order.average_minutes, 1);
  assert.equal(metrics.eating.count, 0); assert.equal(metrics.eating.average_minutes, null);
  visit.status = 'refunded'; metrics = diningMetrics(seated, '2000', '2100');
  assert.equal(metrics.net_sales_cents, 0); assert.equal(metrics.arrival_to_order.count, 0);
});
