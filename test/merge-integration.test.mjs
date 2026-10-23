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

test('a floor seeded before the balcony grew gets Balcony 3 and 4 once, beside the owner\'s own tables', async () => {
  const server = await launch({ prepareData(dir) {
    const db = new DatabaseSync(path.join(dir, 'data.db'));
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES ('tables_seeded', '1'), ('tables_uniform', '1');
      CREATE TABLE floor_tables (id INTEGER PRIMARY KEY, name TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 4, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      INSERT INTO floor_tables (name, seats, x, y, w, h, created_at) VALUES
        ('Balcony 1', 4, 138, 160, 90, 50, '2026-10-18T00:00:00Z'), ('Balcony 2', 4, 300, 300, 90, 50, '2026-10-18T00:00:00Z'),
        ('balcony 4', 2, 500, 500, 44, 44, '2026-10-18T00:00:00Z'), ('Couch', 3, 738, 140, 90, 50, '2026-10-18T00:00:00Z'),
        ('Table 2', 2, 358, 103, 44, 44, '2026-10-18T00:00:00Z'), ('Table 3', 2, 400, 400, 44, 44, '2026-10-18T00:00:00Z');`);
    db.close();
  } });
  try {
    const tables = (await server.request('/api/tables', await server.login('admin'))).data;
    const balcony = tables.filter(t => /^balcony/i.test(t.name)).map(t => [t.name, t.seats, t.x, t.y]);
    // Balcony 3 is added and Balcony 1 moves onto the grid; the owner's moved Balcony 2 and their own "balcony 4" are left alone.
    assert.deepEqual(balcony, [['Balcony 1', 4, 138, 140], ['Balcony 2', 4, 300, 300], ['balcony 4', 2, 500, 500], ['Balcony 3', 4, 138, 380]]);
    // The old 3-seat couch becomes the L-shaped couch for six, then moves onto the grid.
    const couch = tables.find(t => t.name === 'Couch');
    assert.deepEqual([couch.seats, couch.x, couch.y, couch.w, couch.h], [6, 730, 137, 136, 56]);
    // Tables still where an earlier plan put them move onto the grid; ones the owner moved stay put.
    assert.deepEqual(['Table 2', 'Table 3'].map(n => { const t = tables.find(x => x.name === n); return [t.x, t.y]; }), [[316, 143], [400, 400]]);
  } finally { await server.close(); }
});
