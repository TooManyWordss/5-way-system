import crypto from 'node:crypto';
import { applyDining, clone, DiningError, text, integer, linesOf, diningMetrics } from './dining-domain.js';

export function initDiningSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dining_meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO dining_meta (id, revision) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS dining_tables (id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dining_visits (id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dining_operations (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL, actor TEXT NOT NULL, actor_name TEXT,
      at TEXT NOT NULL, received_at TEXT NOT NULL, status TEXT NOT NULL,
      operation TEXT NOT NULL, changes TEXT, result TEXT, error TEXT, resolution TEXT,
      reversed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS dining_operations_status ON dining_operations(status, received_at);
    CREATE TABLE IF NOT EXISTS business_reversals (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, actor_name TEXT, at TEXT NOT NULL,
      kind TEXT NOT NULL, target_id INTEGER NOT NULL, before_json TEXT, after_json TEXT NOT NULL,
      reversed_by TEXT, note TEXT
    );
  `);
  for (const [table, columns] of Object.entries({
    orders: { visit_id: 'TEXT', discount_cents: 'INTEGER NOT NULL DEFAULT 0', discount_json: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1' },
    order_items: { ready_qty: 'INTEGER NOT NULL DEFAULT 0', note: "TEXT NOT NULL DEFAULT ''" },
    menu_items: { version: 'INTEGER NOT NULL DEFAULT 1' },
    inventory_items: { version: 'INTEGER NOT NULL DEFAULT 1' },
    dining_operations: { actor_staff_id: 'INTEGER' },
    business_reversals: { actor_staff_id: 'INTEGER' },
    events: { active: 'INTEGER NOT NULL DEFAULT 1', version: 'INTEGER NOT NULL DEFAULT 1' },
  })) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [key, definition] of Object.entries(columns)) if (!existing.has(key)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${key} ${definition}`);
    if (table === 'order_items' && !existing.has('ready_qty')) db.exec("UPDATE order_items SET ready_qty = qty WHERE sends_to_kitchen = 1 AND order_id IN (SELECT id FROM orders WHERE kitchen_status = 'ready')");
  }
  db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function registerDining({ app, db, requireRole, currentStore, broadcast, taxRate, loadOrder, logActivity, announceStock, receiptConfig }) {
  const onlyAmbiente = (req, res, next) => currentStore() === 'ambiente' ? next() : res.status(404).json({ error: 'Table service is available at Café Ambiente' });
  const readState = () => ({ ...Object.fromEntries(['tables', 'visits'].map(kind => [kind, Object.fromEntries(db.prepare(`SELECT id, document FROM dining_${kind}`).all().map(r => [r.id, JSON.parse(r.document)]))])), counterOrders: Object.fromEntries(db.prepare("SELECT id FROM orders WHERE visit_id IS NULL AND status = 'paid' AND (kitchen_status IN ('new', 'preparing') OR created_at >= ?)").all(new Date(Date.now() - 2 * 86400000).toISOString()).map(r => [String(r.id), loadOrder(r.id)])) });
  const writeState = (state, before) => {
    for (const kind of ['tables', 'visits']) {
      // Tombstones preserve table/visit identities when creations are reversed.
      const save = db.prepare(`INSERT INTO dining_${kind} (id, version, document) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, document = excluded.document`);
      for (const record of Object.values(state[kind])) {
        if (before?.[kind]?.[record.id] && JSON.stringify(before[kind][record.id]) === JSON.stringify(record)) continue;
        save.run(record.id, record.version, JSON.stringify(record));
      }
    }
  };
  const menu = () => db.prepare("SELECT *, unavailable_since IS NULL AS available FROM menu_items WHERE active = 1 AND status = 'approved' ORDER BY category, name").all();
  const changed = (before, after) => ['tables', 'visits', 'counterOrders'].flatMap(kind => [...new Set([...Object.keys(before[kind]), ...Object.keys(after[kind])])].filter(id => JSON.stringify(before[kind][id]) !== JSON.stringify(after[kind][id])).map(id => ({ kind, id, before: before[kind][id] ?? null, after: after[kind][id] ?? null })));
  const writeCounter = order => {
    db.prepare('UPDATE orders SET kitchen_status = ?, kitchen_started_at = ?, kitchen_ready_at = ?, version = ? WHERE id = ?').run(order.kitchen_status, order.kitchen_started_at, order.kitchen_ready_at, order.version, order.id);
    for (const line of order.items) db.prepare('UPDATE order_items SET ready_qty = ? WHERE id = ? AND order_id = ?').run(line.ready_qty, line.id, order.id);
  };
  const announce = () => broadcast(['pos', 'kitchen', 'admin']).emit('dining.updated');
  const actor = req => req.staff?.name ?? req.role;
  const bumpRevision = () => db.prepare('UPDATE dining_meta SET revision = revision + 1 WHERE id = 1').run();
  const sameActor = (row, req) => row.actor === req.role && (row.actor_staff_id ?? 0) === (req.staff?.id ?? 0);
  // Reversing a dependent action restores its values with a newer version. That
  // must not prevent safely undoing the preceding action afterwards.
  const comparable = record => {
    if (record == null) return 'null';
    const { version, edited_at, edit_count, updated_at, updated_by, ...business } = record;
    return JSON.stringify(business);
  };
  const handle = fn => (req, res, next) => { try { fn(req, res); } catch (e) { if (e instanceof DiningError) res.status(e.status).json({ error: e.message }); else next(e); } };
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  function receipt(req, visit, operation) {
    const no = db.prepare("SELECT COALESCE(MAX(receipt_no), 1000) + 1 AS n FROM orders WHERE station = 'cashier'").get().n;
    const bill = visit.bill;
    const id = Number(db.prepare(`INSERT INTO orders (client_id, station, receipt_no, created_at, payment_method, subtotal_cents, tax_cents, total_cents, kitchen_status, cash_tendered_cents, change_cents, staff_id, staff_name, visit_id, discount_cents, discount_json) VALUES (?, 'cashier', ?, ?, 'cash', ?, ?, ?, 'none', ?, ?, ?, ?, ?, ?, ?)`).run(`dining:${operation.id}`, no, visit.settled_at, bill.subtotal_cents, bill.tax_cents, bill.total_cents, visit.cash_cents, visit.change_cents, req.staff?.id ?? null, actor(req), visit.id, bill.discount_cents, JSON.stringify(visit.discount)).lastInsertRowid);
    const insert = db.prepare('INSERT INTO order_items (order_id, menu_item_id, name, unit_price_cents, qty, sends_to_kitchen, ready_qty, note) VALUES (?, ?, ?, ?, ?, 0, ?, ?)');
    for (const line of linesOf(visit).filter(l => l.qty > 0)) insert.run(id, line.menu_item_id, line.name, line.unit_price_cents, line.qty, line.ready_qty, line.note);
    visit.receipt_id = id; visit.receipt_no = no;
    return id;
  }
  function validateEnvelope(op) {
    if (!op || typeof op !== 'object') throw new DiningError('Missing operation');
    for (const key of ['id', 'deviceId', 'type', 'targetId']) text(op[key], key, 100);
    integer(op.expectedVersion, 'record version');
    if (op.dependsOn != null) text(op.dependsOn, 'dependency ID', 100);
    if (op.payload == null || typeof op.payload !== 'object' || Array.isArray(op.payload)) throw new DiningError('Invalid operation payload');
    if (!Number.isFinite(Date.parse(op.at))) throw new DiningError('Invalid operation time');
  }
  const viewOperation = row => ({ ...row, operation: JSON.parse(row.operation), changes: JSON.parse(row.changes ?? '[]'), result: JSON.parse(row.result ?? 'null'), resolution: JSON.parse(row.resolution ?? 'null') });
  function apply(req, op) {
    validateEnvelope(op);
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM dining_operations WHERE id = ?').get(op.id);
      if (existing) {
        if (existing.operation !== JSON.stringify(op)) throw new DiningError('Operation ID was reused with different content', 409);
        return viewOperation(existing);
      }
      const before = readState();
      let after, error;
      try {
        if (op.dependsOn && db.prepare('SELECT status FROM dining_operations WHERE id = ?').get(op.dependsOn)?.status !== 'applied') throw new DiningError('An earlier operation needs owner review', 409);
        after = applyDining(before, op, { role: req.role, menu: menu(), taxRate });
      } catch (e) {
        if (!(e instanceof DiningError)) throw e;
        // Authorization errors are never queued for an owner to accidentally approve.
        if (e.status === 403) throw e;
        error = e.message;
      }
      let result = null;
      if (after) {
        if (op.type === 'counter.kitchen') writeCounter(after.counterOrders[op.targetId]);
        if (op.type === 'visit.settle') {
          const id = receipt(req, after.visits[op.targetId], op);
          result = { receipt: loadOrder(id) };
        }
        writeState(after, before);
      }
      db.prepare('INSERT INTO dining_operations (id, device_id, actor, actor_name, actor_staff_id, at, received_at, status, operation, changes, result, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(op.id, op.deviceId, req.role, actor(req), req.staff?.id ?? null, op.at, new Date().toISOString(), after ? 'applied' : 'conflict', JSON.stringify(op), after ? JSON.stringify(changed(before, after)) : null, JSON.stringify(result), error ?? null);
      logActivity(req, after ? `dining.${op.type}` : 'dining.conflict', `${op.type}: ${op.targetId}${error ? ` — ${error}` : ''}`);
      bumpRevision();
      return viewOperation(db.prepare('SELECT * FROM dining_operations WHERE id = ?').get(op.id));
    });
  }
  app.use('/api/dining', onlyAmbiente, requireRole('pos', 'kitchen', 'inventory', 'barista'));
  app.use('/api/dining', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/dining/state', requireRole('pos', 'kitchen'), handle((req, res) => {
    const state = readState();
    res.json({ ...state, revision: db.prepare('SELECT revision FROM dining_meta WHERE id = 1').get().revision, menu: menu(), taxRate, receipt: receiptConfig(), serverTime: new Date().toISOString() });
  }));
  app.post('/api/dining/sync', requireRole('pos', 'kitchen'), handle((req, res) => {
    const operations = req.body?.operations;
    if (!Array.isArray(operations) || operations.length > 100) throw new DiningError('Send up to 100 operations');
    // Every operation commits independently; retrying a partially completed batch is safe.
    const results = operations.map(op => apply(req, op));
    announce();
    for (const result of results) {
      if (result.result?.receipt) broadcast(['pos', 'admin']).emit('order.created', result.result.receipt);
      if (result.status === 'applied' && result.operation.type === 'counter.kitchen') broadcast(['pos', 'admin', 'kitchen']).emit('ticket.updated', loadOrder(Number(result.operation.targetId)));
    }
    res.json({ results });
  }));
  app.get('/api/dining/history', handle((req, res) => {
    const rows = db.prepare("SELECT * FROM dining_operations WHERE status = 'conflict' OR rowid IN (SELECT rowid FROM dining_operations ORDER BY received_at DESC, rowid DESC LIMIT 200) ORDER BY received_at DESC, rowid DESC").all().map(viewOperation);
    res.json(req.role === 'admin' ? rows : rows.filter(r => sameActor(r, req)));
  }));
  app.post('/api/dining/undo/:id', handle((req, res) => {
    const outcome = transaction(() => {
      const row = db.prepare('SELECT * FROM dining_operations WHERE id = ?').get(req.params.id);
      if (!row || row.status !== 'applied' || row.reversed_by) throw new DiningError('This action cannot be undone', 409);
      if (req.role !== 'admin' && !sameActor(row, req)) throw new DiningError('Only the original actor or owner can undo this action', 403);
      const op = JSON.parse(row.operation), changes = JSON.parse(row.changes);
      const state = readState(), before = clone(state), id = crypto.randomUUID(), at = new Date().toISOString();
      if (op.type === 'undo') throw new DiningError('Use a new business action to change an undo', 409);
      for (const c of changes) {
        if (comparable(state[c.kind][c.id] ?? null) !== comparable(c.after)) throw new DiningError('Later changes depend on this action. Edit the current record instead.', 409);
      }
      let refund_cents = 0;
      if (op.type === 'visit.settle') {
        const v = state.visits[op.targetId];
        const paid = loadOrder(v.receipt_id);
        if (!paid || paid.status !== 'paid') throw new DiningError('Receipt already changed. Review the receipt history.', 409);
        refund_cents = paid.total_cents;
        db.prepare("UPDATE orders SET status = 'voided', void_reason = 'Table settlement reversed', voided_at = ?, voided_by = ?, version = version + 1 WHERE id = ?").run(at, req.role, paid.id);
        v.status = 'refunded'; v.refunded_at = at; v.version++;
        for (const s of v.submissions) { s.cancelled_at = at; s.cancel_reason = 'Settlement reversed'; s.change_seq = (s.change_seq ?? 0) + 1; }
        // Keep the paid bill snapshot and receipt link for refund reconciliation.
      } else {
        for (const c of changes) {
          const restored = c.before ? clone(c.before) : c.kind === 'tables' ? { ...c.after, active: false, visit_id: null } : { ...c.after, status: 'cancelled', cancelled_at: at, cancel_reason: 'Seating reversed' };
          restored.version = (c.after?.version ?? 0) + 1;
          state[c.kind][c.id] = restored;
        }
        if (op.type === 'visit.submit') {
          const v = state.visits[op.targetId], s = clone(before.visits[op.targetId].submissions.find(s => s.id === op.payload.submissionId));
          s.cancelled_at = at; s.cancel_reason = 'Order submission reversed'; s.change_seq = (s.change_seq ?? 0) + 1;
          for (const line of s.lines) { line.changes.push({ at, previous_qty: line.qty, qty: 0, previous_note: line.note, note: 'Order submission reversed' }); line.qty = 0; line.ready_qty = 0; }
          v.submissions.push(s);
        }
        if (op.type === 'visit.line') {
          const v = state.visits[op.targetId], s = v.submissions.find(s => s.lines.some(l => l.id === op.payload.lineId)), line = s.lines.find(l => l.id === op.payload.lineId);
          const old = linesOf(before.visits[op.targetId]).find(l => l.id === line.id);
          line.changes.push({ at, previous_qty: old.qty, qty: line.qty, previous_note: old.note, note: line.note });
          s.change_seq = (before.visits[op.targetId].submissions.find(x => x.id === s.id).change_seq ?? 0) + 1;
        }
      }
      const names = new Set();
      for (const table of Object.values(state.tables)) {
        const name = table.name.toLocaleLowerCase();
        if (names.has(name)) throw new DiningError('That table name is now used by another table. Rename it before undoing.', 409);
        names.add(name);
      }
      writeState(state, before);
      if (op.type === 'counter.kitchen') writeCounter(state.counterOrders[op.targetId]);
      const reversal = { id, deviceId: 'server', type: 'undo', targetId: op.targetId, expectedVersion: 0, at, payload: { operationId: row.id } };
      db.prepare("INSERT INTO dining_operations (id, device_id, actor, actor_name, actor_staff_id, at, received_at, status, operation, changes, result) VALUES (?, 'server', ?, ?, ?, ?, ?, 'applied', ?, ?, ?)").run(id, req.role, actor(req), req.staff?.id ?? null, at, at, JSON.stringify(reversal), JSON.stringify(changed(before, state)), JSON.stringify({ refund_cents }));
      db.prepare('UPDATE dining_operations SET reversed_by = ? WHERE id = ?').run(id, row.id);
      logActivity(req, 'dining.undo', `Undid ${op.type}${refund_cents ? `; return ₱${(refund_cents / 100).toFixed(2)}` : ''}`);
      bumpRevision();
      return { refund_cents };
    });
    announce();
    const original = db.prepare('SELECT operation FROM dining_operations WHERE id = ?').get(req.params.id);
    const op = JSON.parse(original.operation), state = readState();
    const orderId = op.type === 'counter.kitchen' ? Number(op.targetId) : state.visits[op.targetId]?.receipt_id;
    if (orderId) broadcast(['pos', 'admin', 'kitchen']).emit('order.updated', loadOrder(orderId));
    res.json(outcome);
  }));
  app.post('/api/dining/conflicts/:id/resolve', requireRole('admin'), handle((req, res) => {
    const row = db.prepare('SELECT * FROM dining_operations WHERE id = ?').get(req.params.id);
    if (!row || row.status !== 'conflict') throw new DiningError('Conflict already resolved or not found', 409);
    const note = text(req.body?.note, 'resolution note', 1000);
    const cashCorrection = integer(req.body?.cashCorrectionCents, 'cash correction', -Number.MAX_SAFE_INTEGER);
    const action = req.body?.action;
    let retried = null;
    if (action === 'retry') {
      const original = JSON.parse(row.operation);
      const replacement = req.body?.operation;
      validateEnvelope(replacement);
      if (replacement.type !== original.type || replacement.id === original.id) throw new DiningError('Retry must keep the action type and use a new ID');
      retried = apply(req, replacement);
      if (retried.status !== 'applied') return res.status(409).json({ error: retried.error, retryId: retried.id });
    } else if (action !== 'dismiss') throw new DiningError('Choose retry or dismiss');
    const resolution = { action, note, cashCorrectionCents: cashCorrection, actor: actor(req), at: new Date().toISOString(), replacementId: retried?.id ?? null };
    db.prepare("UPDATE dining_operations SET status = ?, resolution = ? WHERE id = ?").run(action === 'retry' ? 'applied' : 'dismissed', JSON.stringify(resolution), row.id);
    logActivity(req, 'dining.resolved', `Resolved ${row.id}: ${note}; cash correction ${cashCorrection} centavos`);
    bumpRevision();
    announce(); res.json({ resolution, result: retried?.result ?? null });
  }));
  app.get('/api/dining/metrics', requireRole('admin'), handle((req, res) => {
    const from = String(req.query.from ?? ''), to = String(req.query.to ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new DiningError('Choose a valid date range');
    const start = new Date(`${from}T00:00:00+08:00`).toISOString();
    const end = new Date(Date.parse(`${to}T00:00:00+08:00`) + 86400000).toISOString();
    const days = (Date.parse(end) - Date.parse(start)) / 86400000;
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new DiningError('Choose a range of up to 366 days');
    const state = readState();
    const previousStart = new Date(Date.parse(start) - days * 86400000).toISOString();
    const daily = Array.from({ length: days }, (_, i) => {
      const at = Date.parse(start) + i * 86400000;
      return { date: new Date(at + 8 * 3600000).toISOString().slice(0, 10), ...diningMetrics(state, new Date(at).toISOString(), new Date(at + 86400000).toISOString()) };
    });
    res.json({ ...diningMetrics(state, start, end), daily,
      previous: diningMetrics(state, previousStart, start),
      previousFrom: new Date(Date.parse(previousStart) + 8 * 3600000).toISOString().slice(0, 10),
      previousTo: new Date(Date.parse(start) - 86400000 + 8 * 3600000).toISOString().slice(0, 10) });
  }));
  app.patch('/api/dining/menu/:id', requireRole('admin'), handle((req, res) => {
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(req.params.id));
    if (!item) throw new DiningError('Menu item not found', 404);
    if (item.version !== req.body?.expectedVersion) throw new DiningError('Menu changed; reload before saving', 409);
    const p = req.body;
    const name = text(p.name, 'menu name', 120), category = text(p.category, 'category', 80);
    const price = integer(p.price_cents, 'price', 1, 100000000);
    if (typeof p.available !== 'boolean' || typeof p.sends_to_kitchen !== 'boolean') throw new DiningError('Choose availability and kitchen routing');
    if (db.prepare("SELECT id FROM menu_items WHERE id != ? AND name = ? COLLATE NOCASE AND category = ? COLLATE NOCASE AND active = 1 AND status = 'approved'").get(item.id, name, category)) throw new DiningError('This menu name and category already exist', 409);
    transaction(() => {
      db.prepare('UPDATE menu_items SET name = ?, category = ?, price_cents = ?, sends_to_kitchen = ?, unavailable_since = ?, version = version + 1 WHERE id = ?').run(name, category, price, Number(p.sends_to_kitchen), p.available ? null : item.unavailable_since ?? new Date().toISOString(), item.id);
      recordBusiness(req, 'menu', item.id, item, db.prepare('SELECT * FROM menu_items WHERE id = ?').get(item.id));
      logActivity(req, 'menu.edited', `Updated menu: ${name}`);
    });
    broadcast(['pos', 'barista', 'admin']).emit('menu.updated'); announce(); res.json({ ok: true });
  }));

  // Existing counter sales and stock tools gain compensating undo without changing their contracts.
  const businessSnapshot = (kind, id) => kind === 'order' ? loadOrder(id) : kind === 'event-visibility' ? { hidden: JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'hidden_events'").get()?.value ?? '[]') } : db.prepare(`SELECT * FROM ${kind === 'stock' ? 'inventory_items' : kind === 'event' ? 'events' : 'menu_items'} WHERE id = ?`).get(id) ?? null;
  function recordBusiness(req, kind, id, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const undoId = crypto.randomUUID();
    db.prepare('INSERT INTO business_reversals (id, actor, actor_name, actor_staff_id, at, kind, target_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(undoId, req.role, actor(req), req.staff?.id ?? null, new Date().toISOString(), kind, id, JSON.stringify(before), JSON.stringify(after));
    bumpRevision();
    return undoId;
  }
  app.use((req, res, next) => {
    if (currentStore() !== 'ambiente' || !['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();
    let match, kind;
    if ((match = /^\/api\/orders(?:\/(\d+)(?:\/(void|kitchen|item-ready))?)?$/.exec(req.path))) kind = 'order';
    else if ((match = /^\/api\/(?:admin\/)?inventory\/(\d+)(?:\/stock)?$/.exec(req.path))) kind = 'stock';
    else if ((match = /^\/api\/menu\/(\d+)\/availability$/.exec(req.path))) kind = 'menu';
    else if (req.path === '/api/inventory/items') { kind = 'stock'; match = []; }
    else if (req.path === '/api/menu/requests') { kind = 'menu'; match = []; }
    else if ((match = /^\/api\/admin\/menu-requests\/(\d+)$/.exec(req.path))) kind = 'menu';
    else if (req.path === '/api/admin/events/visibility') { kind = 'event-visibility'; match = []; }
    else if ((match = /^\/api\/admin\/events(?:\/(\d+))?$/.exec(req.path))) kind = 'event';
    if (!kind) return next();
    const id = kind === 'event-visibility' ? 0 : match[1] ? Number(match[1]) : null;
    const priorSale = kind === 'order' && !id && req.body?.clientId ? db.prepare('SELECT id FROM orders WHERE client_id = ?').get(req.body.clientId) : null;
    const before = id !== null || priorSale ? businessSnapshot(kind, id ?? priorSale.id) : null;
    if (kind === 'order' && before?.visit_id) return res.status(409).json({ error: 'Use the table visit history and Undo settlement for this receipt.' });
    if (before && req.body?.expectedVersion !== undefined && req.body.expectedVersion !== before.version) return res.status(409).json({ error: 'This record changed. Reload it before saving.' });
    const json = res.json.bind(res);
    // The selected legacy handlers are synchronous. Their writes, version bump,
    // and undo record commit together; nested order writes use savepoints too.
    db.exec('SAVEPOINT captured_business_action');
    res.json = data => {
      res.json = json;
      try {
      if (res.statusCode < 400) {
        const target = id ?? data?.id;
        if (target !== null && target !== undefined) {
          const afterWrite = businessSnapshot(kind, target);
          if (comparable(before) !== comparable(afterWrite)) {
            if (kind !== 'event-visibility') db.prepare(`UPDATE ${kind === 'stock' ? 'inventory_items' : kind === 'order' ? 'orders' : kind === 'event' ? 'events' : 'menu_items'} SET version = version + 1 WHERE id = ?`).run(target);
            const after = businessSnapshot(kind, target), undoId = recordBusiness(req, kind, target, before, after);
            if (undoId && data && typeof data === 'object') {
              data.undoId = undoId;
              if (data.order) data.order = after;
              else if (data.id && typeof data.version === 'number') data.version = after.version;
            }
          }
        }
        db.exec('RELEASE captured_business_action');
      } else {
        db.exec('ROLLBACK TO captured_business_action; RELEASE captured_business_action');
      }
      } catch (error) {
        db.exec('ROLLBACK TO captured_business_action; RELEASE captured_business_action');
        throw error;
      }
      return json(data);
    };
    next();
  });
  app.get('/api/dining/business-history', handle((req, res) => {
    const rows = db.prepare('SELECT * FROM business_reversals ORDER BY at DESC LIMIT 100').all();
    res.json(rows.filter(r => req.role === 'admin' || sameActor(r, req)));
  }));
  app.post('/api/dining/business-undo/:id', handle((req, res) => {
    const result = transaction(() => {
      const row = db.prepare('SELECT * FROM business_reversals WHERE id = ?').get(req.params.id);
      if (!row || row.reversed_by || row.note?.startsWith('Reversal of ')) throw new DiningError('Action already reversed or not found', 409);
      if (req.role !== 'admin' && !sameActor(row, req)) throw new DiningError('Only the original actor or owner can undo this action', 403);
      const before = JSON.parse(row.before_json), after = JSON.parse(row.after_json), current = businessSnapshot(row.kind, row.target_id);
      if (comparable(current) !== comparable(after)) throw new DiningError('Later changes depend on this action. Edit the current record instead.', 409);
      let cash_correction_cents = 0;
      if (row.kind === 'order') {
        if (req.role !== 'admin' && (current.station !== (req.role === 'barista' ? 'barista' : 'cashier') || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(current.created_at)) !== new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()))) throw new DiningError('Ask the owner to reverse a previous day or different till receipt', 403);
        if (!before) {
          cash_correction_cents = -current.total_cents;
          db.prepare("UPDATE orders SET status = 'voided', void_reason = 'Sale reversed', voided_at = ?, voided_by = ?, kitchen_status = 'cancelled', version = version + 1 WHERE id = ?").run(new Date().toISOString(), req.role, current.id);
        } else {
          cash_correction_cents = (before.status === 'paid' ? before.total_cents : 0) - (current.status === 'paid' ? current.total_cents : 0);
          const fields = ['subtotal_cents', 'tax_cents', 'total_cents', 'discount_cents', 'discount_json', 'status', 'kitchen_status', 'kitchen_started_at', 'kitchen_ready_at', 'cash_tendered_cents', 'change_cents', 'void_reason', 'voided_at', 'voided_by'];
          db.prepare(`UPDATE orders SET ${fields.map(f => `${f} = ?`).join(', ')}, edit_count = edit_count + 1, edited_at = ?, version = version + 1 WHERE id = ?`).run(...fields.map(f => before[f] ?? null), new Date().toISOString(), current.id);
          db.prepare('DELETE FROM order_items WHERE order_id = ?').run(current.id);
          for (const l of before.items) db.prepare('INSERT INTO order_items (id, order_id, menu_item_id, name, unit_price_cents, qty, sends_to_kitchen, ready_qty, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(l.id, current.id, l.menu_item_id, l.name, l.unit_price_cents, l.qty, l.sends_to_kitchen, l.ready_qty, l.note);
        }
      } else if (row.kind === 'event-visibility') {
        db.prepare("INSERT INTO settings (key, value) VALUES ('hidden_events', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(before.hidden));
      } else {
        const fields = row.kind === 'stock' ? ['name', 'unit', 'quantity', 'threshold', 'active'] : row.kind === 'event' ? ['name', 'start_date', 'end_date', 'kind', 'note', 'active'] : ['name', 'category', 'price_cents', 'sends_to_kitchen', 'unavailable_since', 'active', 'status', 'requested_by', 'requested_at', 'reviewed_at'];
        const restored = before ?? { ...current, active: 0, quantity: 0, status: 'rejected' };
        if (row.kind === 'menu' && restored.active && db.prepare("SELECT id FROM menu_items WHERE id != ? AND name = ? COLLATE NOCASE AND category = ? COLLATE NOCASE AND active = 1 AND status = 'approved'").get(current.id, restored.name, restored.category)) throw new DiningError('Another menu item now uses that name and category. Rename it before undoing.', 409);
        db.prepare(`UPDATE ${row.kind === 'stock' ? 'inventory_items' : row.kind === 'event' ? 'events' : 'menu_items'} SET ${fields.map(f => `${f} = ?`).join(', ')}, version = version + 1 WHERE id = ?`).run(...fields.map(f => restored[f]), current.id);
        if (row.kind === 'stock') {
          db.prepare('UPDATE inventory_items SET updated_at = ?, updated_by = ? WHERE id = ?').run(new Date().toISOString(), actor(req), current.id);
          const updated = businessSnapshot('stock', current.id);
          db.prepare("INSERT INTO inventory_log (item_id, at, actor, actor_name, kind, change, quantity_after, note) VALUES (?, ?, ?, ?, 'undo', ?, ?, ?)").run(current.id, new Date().toISOString(), req.role, actor(req), updated.quantity - current.quantity, updated.quantity, `Reversal of ${row.id}`);
          if (updated.active) announceStock(req, current.active ? current : null, updated);
          else broadcast(['inventory', 'admin']).emit('inventory.updated', { ...updated, low: false });
        }
      }
      const reversalId = recordBusiness(req, row.kind, row.target_id, current, businessSnapshot(row.kind, row.target_id));
      db.prepare('UPDATE business_reversals SET note = ? WHERE id = ?').run(`Reversal of ${row.id}`, reversalId);
      db.prepare('UPDATE business_reversals SET reversed_by = ? WHERE id = ?').run(reversalId, row.id);
      logActivity(req, 'business.undo', `Reversed ${row.kind} ${row.target_id}; cash correction ${cash_correction_cents} centavos`);
      return { cash_correction_cents };
    });
    announce(); broadcast(['pos', 'barista', 'kitchen', 'admin', 'inventory']).emit('menu.updated');
    const reversed = db.prepare('SELECT kind, target_id FROM business_reversals WHERE id = ?').get(req.params.id);
    if (reversed.kind === 'order') broadcast(['pos', 'barista', 'kitchen', 'admin']).emit('order.updated', loadOrder(reversed.target_id));
    res.json(result);
  }));
}
