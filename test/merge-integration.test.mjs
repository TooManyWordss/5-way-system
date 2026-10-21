import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launch } from './support/server.mjs';

test('floor-plan receipts feed KPIs and audited undo reverses recipe stock', async () => {
  const server = await launch();
  try {
    const { request, login } = server, owner = await login('admin'), pos = await login('pos');
    const menu = (await request('/api/menu', pos)).data.items;
    const item = menu.find(i => i.available);
    const stock = (await request('/api/inventory/items', owner, { name: 'Merge ingredient', unit: 'pcs', quantity: 10, threshold: 2 })).data;
    assert.equal((await request(`/api/admin/recipes/${item.id}`, owner, { ingredients: [{ inventoryItemId: stock.id, qty: 1 }] }, 'PUT')).status, 200);
    const table = (await request('/api/tables', pos)).data[0];
    const sale = await request('/api/orders', pos, { clientId: 'merge-sale', items: [{ menuItemId: item.id, qty: 2 }], table: { tableId: table.id, guests: 3, seatedAt: new Date().toISOString() } });
    assert.equal(sale.status, 201);
    const quantity = async () => (await request('/api/admin/inventory', owner)).data.items.find(i => i.id === stock.id).quantity;
    assert.equal(await quantity(), 8);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const metrics = (await request(`/api/dining/metrics?from=${date}&to=${date}`, owner)).data;
    assert.equal(metrics.paid_visits, 1);
    assert.equal(metrics.guests_served, 3);
    assert.equal(metrics.net_sales_cents, sale.data.subtotal_cents);
    assert.equal((await request(`/api/dining/business-undo/${sale.data.undoId}`, pos, {})).status, 200);
    assert.equal(await quantity(), 10);
    assert.equal((await request(`/api/dining/metrics?from=${date}&to=${date}`, owner)).data.paid_visits, 0);
  } finally { await server.close(); }
});

for (const format of ['floor', 'documents']) test(`existing ${format} table data survives initialization`, async () => {
  const server = await launch({ prepareData(dir) {
    const db = new DatabaseSync(path.join(dir, 'data.db'));
    if (format === 'floor') {
      db.exec(`CREATE TABLE dining_tables (id INTEGER PRIMARY KEY, name TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 4, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        INSERT INTO dining_tables VALUES (77, 'Existing window table', 4, 100, 100, 50, 90, 1, '2026-10-18T00:00:00Z');`);
    } else {
      db.exec(`CREATE TABLE dining_tables (id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL)`);
      db.prepare('INSERT INTO dining_tables VALUES (?, ?, ?)').run('existing-document', 1, JSON.stringify({ id: 'existing-document', version: 1, name: 'Existing tab table', active: true, visit_id: null }));
    }
    db.close();
  } });
  try {
    const owner = await server.login('admin');
    if (format === 'floor') assert.ok((await server.request('/api/tables', owner)).data.some(t => t.id === 77 && t.name === 'Existing window table'));
    else assert.equal((await server.request('/api/dining/state', owner)).data.tables['existing-document'].name, 'Existing tab table');
    assert.equal((await server.request('/api/dining/state', owner)).status, 200);
  } finally { await server.close(); }
});
