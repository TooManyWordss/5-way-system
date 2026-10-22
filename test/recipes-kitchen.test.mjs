import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('sales take recipe stock out, edits and voids adjust it, and the kitchen marks single items ready', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiente-recipes-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), POS_PIN: '1234', KITCHEN_PIN: '4321', INVENTORY_PIN: '5555',
      ADMIN_PASSWORD: 'owner-password', SESSION_SECRET: 'recipes-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 15000);
      child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('5 Way System running')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const call = async (url, cookie, method = 'GET', body) => {
      const response = await fetch(base + url, {
        method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    };
    const login = async (role, secret) => {
      const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, secret }) });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const owner = await login('admin', 'owner-password');
    const pos = await login('pos', '1234');
    const kitchen = await login('kitchen', '4321');

    const { body: menu } = await call('/api/menu', pos);
    const bar = ['Sparkling Wine', 'White Wine', 'Red Wine', 'Dessert Wine', 'Whiskey', 'Beer'];
    const [corn, other] = menu.items.filter((i) => i.available && !bar.includes(i.category));
    const { body: stock } = await call('/api/inventory/items', owner, 'POST', { name: 'Corn', unit: 'pcs', quantity: 5, threshold: 3 });
    const put = await call(`/api/admin/recipes/${corn.id}`, owner, 'PUT', { ingredients: [{ inventoryItemId: stock.id, qty: 1 }] });
    assert.equal(put.status, 200);
    const cornStock = async () => (await call('/api/admin/inventory', owner)).body.items.find((i) => i.id === stock.id).quantity;

    // Selling 2 takes 2 out and crosses the reorder level, which is logged for the owner.
    const sale = await call('/api/orders', pos, 'POST', { clientId: 'sale-1', items: [{ menuItemId: corn.id, qty: 2 }, { menuItemId: other.id, qty: 1 }] });
    assert.equal(sale.status, 201);
    assert.equal(await cornStock(), 3);
    const sale2 = await call('/api/orders', pos, 'POST', { clientId: 'sale-2', items: [{ menuItemId: corn.id, qty: 1 }] });
    assert.equal(await cornStock(), 2);
    const day = (await call('/api/admin/day', owner)).body;
    assert.ok(day.logs.some((l) => l.action === 'inventory.low' && l.message.includes('Corn')));

    // Editing down to 1 puts 1 back; voiding puts the rest back.
    const edit = await call(`/api/orders/${sale.body.id}`, owner, 'PATCH', { items: [{ menuItemId: corn.id, qty: 1 }, { menuItemId: other.id, qty: 1 }] });
    assert.equal(edit.status, 200);
    assert.equal(await cornStock(), 3);
    assert.equal((await call(`/api/orders/${sale2.body.id}/void`, pos, 'POST', { reason: 'test' })).status, 200);
    assert.equal(await cornStock(), 4);

    // The kitchen marks one item ready; the ticket stays open until the last one is.
    const order = edit.body.order;
    {
      assert.ok(order.items.every((i) => i.sends_to_kitchen));
      const [first, second] = order.items;
      // Tapping an item once starts it cooking; the ticket counts as started but nothing is ready yet.
      const cooking = await call(`/api/orders/${order.id}/items/${second.id}/kitchen`, kitchen, 'PATCH', { state: 'cooking' });
      assert.equal(cooking.body.kitchen_status, 'preparing');
      const cookingItem = cooking.body.items.find((i) => i.id === second.id);
      assert.ok(cookingItem.kitchen_started_at && !cookingItem.kitchen_ready_at);
      const one = await call(`/api/orders/${order.id}/items/${first.id}/kitchen`, kitchen, 'PATCH', { ready: true });
      assert.equal(one.status, 200);
      assert.equal(one.body.kitchen_status, 'preparing');
      assert.ok(one.body.items.find((i) => i.id === first.id).kitchen_ready_at);
      assert.ok(!one.body.items.find((i) => i.id === second.id).kitchen_ready_at);
      const tickets = (await call('/api/kitchen/tickets', kitchen)).body;
      assert.ok(tickets.some((t) => t.id === order.id));

      // An edit that doesn't add more of the ready item keeps its mark.
      const kept = await call(`/api/orders/${order.id}`, owner, 'PATCH', { items: [{ menuItemId: first.menu_item_id, qty: 1 }, { menuItemId: second.menu_item_id, qty: 2 }] });
      const keptItem = kept.body.order.items.find((i) => i.menu_item_id === first.menu_item_id);
      assert.ok(keptItem.kitchen_ready_at);
      const last = kept.body.order.items.find((i) => i.menu_item_id === second.menu_item_id);
      const done = await call(`/api/orders/${order.id}/items/${last.id}/kitchen`, kitchen, 'PATCH', { ready: true });
      assert.equal(done.body.kitchen_status, 'ready');
      assert.ok(!(await call('/api/kitchen/tickets', kitchen)).body.some((t) => t.id === order.id));
    }

    // Tables: the sketch's layout is there, a party is seated, adds a second order, then bills out.
    const tables = (await call('/api/tables', pos)).body;
    assert.equal(tables.length, 21);
    const t5 = tables.find((t) => t.name === 'Table 5');
    const seatedAt = new Date(Date.now() - 10 * 60000).toISOString();
    const dineIn = await call('/api/orders', pos, 'POST', { clientId: 'table-1', items: [{ menuItemId: other.id, qty: 1 }],
      table: { tableId: t5.id, guests: 3, customerTag: 'vip', seatedAt } });
    assert.equal(dineIn.status, 201);
    assert.equal(dineIn.body.table_name, 'Table 5');
    assert.equal(dineIn.body.seated_at, seatedAt);
    const more = await call('/api/orders', pos, 'POST', { clientId: 'table-2', items: [{ menuItemId: other.id, qty: 1 }],
      table: { tableId: t5.id, guests: 3, seatedAt: new Date().toISOString() } });
    assert.equal(more.body.seated_at, seatedAt, 'a second order keeps the time the party sat down');
    const busy = (await call('/api/tables', pos)).body.find((t) => t.id === t5.id);
    assert.equal(busy.party.receipts.length, 2);
    assert.equal(busy.party.customer_tag, 'vip');
    assert.equal((await call(`/api/admin/tables/${t5.id}`, owner, 'DELETE')).status, 409);
    assert.equal((await call(`/api/tables/${t5.id}/bill-out`, pos, 'POST')).status, 200);
    assert.equal((await call('/api/tables', pos)).body.find((t) => t.id === t5.id).party, null);
    const billed = (await call('/api/admin/day', owner)).body.orders.find((o) => o.id === dineIn.body.id);
    assert.ok(billed.billed_out_at);
    assert.equal((await call(`/api/admin/tables/${t5.id}`, owner, 'PATCH', { name: 'Window', x: 500, y: 500 })).body.name, 'Window');

    // The owner changes their own password from the dashboard; the old one stops working.
    assert.equal((await call('/api/admin/password', owner, 'POST', { current: 'wrong', password: 'new-owner-pass' })).status, 403);
    assert.equal((await call('/api/admin/password', owner, 'POST', { current: 'owner-password', password: 'short' })).status, 400);
    assert.equal((await call('/api/admin/password', owner, 'POST', { current: 'owner-password', password: 'new-owner-pass' })).status, 200);
    const tryLogin = (secret) => fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin', secret }) }).then((r) => r.status);
    assert.equal(await tryLogin('owner-password'), 401);
    assert.equal(await tryLogin('new-owner-pass'), 200);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
