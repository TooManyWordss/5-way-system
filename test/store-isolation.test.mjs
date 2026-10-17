import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('RaiRock orders and credentials stay separate while the owner can see both stores', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'five-way-stores-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), POS_PIN: '1234', BARISTA_PIN: '1234',
      RAIROCK_POS_PIN: '5678', KITCHEN_PIN: '4321', RAIROCK_KITCHEN_PIN: '8765',
      ADMIN_PASSWORD: 'owner-password', SESSION_SECRET: 'store-isolation-test-secret' },
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
    const call = (url, cookie, method = 'GET', body) => fetch(base + url, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    const login = async (prefix, role, secret) => {
      const response = await call(`${prefix}/api/login`, '', 'POST', { role, secret });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const ambienteOwner = await login('', 'admin', 'owner-password');
    const rairockOwner = await login('/rairock', 'admin', 'owner-password');
    assert.match(rairockOwner, /^session_rairock=/);
    assert.equal((await call('/rairock/api/me?role=admin', ambienteOwner)).status, 401);
    assert.equal((await call('/api/me?role=admin', rairockOwner)).status, 401);
    const bothCookies = `${ambienteOwner}; ${rairockOwner}`;
    assert.equal((await call('/api/me?role=admin', bothCookies)).status, 200);
    assert.equal((await call('/rairock/api/me?role=admin', bothCookies)).status, 200);
    const manifest = await (await call('/rairock/pos.webmanifest')).json();
    assert.equal(manifest.start_url, '/rairock/pos');
    assert.equal((await call('/rairock/brand/logo.png')).headers.get('content-type'), 'image/png');
    assert.equal((await call('/rairock/brand/background.png')).headers.get('content-type'), 'image/png');
    assert.equal((await call('/rairock/api/admin/pins/pos', '', 'POST', { pin: '2468' })).status, 401);
    assert.equal((await call('/rairock/api/admin/pins/pos', rairockOwner, 'POST', { pin: 'abc' })).status, 400);
    assert.equal((await call('/rairock/api/admin/pins/pos', rairockOwner, 'POST', { pin: '2468' })).status, 200);
    assert.equal((await call('/rairock/api/login', '', 'POST', { role: 'pos', secret: '5678' })).status, 401);
    assert.equal((await call('/api/login', '', 'POST', { role: 'pos', secret: '1234' })).status, 200);
    const rairockDb = new DatabaseSync(path.join(dir, 'rairock.db'));
    const savedPin = rairockDb.prepare("SELECT value FROM settings WHERE key = 'pin_pos_hash'").get()?.value;
    rairockDb.close();
    assert.match(savedPin, /^scrypt:[a-f0-9]+:[a-f0-9]+$/);
    assert.equal(savedPin.includes('2468'), false);
    assert.equal((await (await call('/rairock/api/menu', rairockOwner)).json()).items.length, 0);
    const ambienteMenu = await (await call('/api/menu', ambienteOwner)).json();
    assert(ambienteMenu.items.every(item => item.description?.length >= 100));
    const baristaCookie = await login('', 'barista', '1234');
    const baristaMenu = await (await call('/api/menu?station=barista', baristaCookie)).json();
    assert.equal(baristaMenu.items[0].description, ambienteMenu.items[0].description);
    assert.equal(ambienteMenu.items.find(item => item.name === 'Espresso Martini').descriptionSources[0].title, 'IBA: Espresso Martini');
    const describedItem = ambienteMenu.items.find(item => item.name === 'Espresso Martini');
    assert.equal((await call(`/api/menu/${describedItem.id}/availability`, ambienteOwner, 'POST', { available: false })).status, 200);
    const unavailableMenu = await (await call('/api/menu', ambienteOwner)).json();
    const unavailableItem = unavailableMenu.items.find(item => item.id === describedItem.id);
    assert.equal(unavailableItem.available, 0);
    assert.equal(unavailableItem.description, describedItem.description);
    // An identical item name in the other store must not acquire Ambiente's recipe description.
    assert.equal((await call('/rairock/api/menu/requests', rairockOwner, 'POST',
      { name: 'Espresso Martini', category: 'Cocktails', priceCents: 39900 })).status, 201);
    const rairockMenu = await (await call('/rairock/api/menu', rairockOwner)).json();
    assert.equal(rairockMenu.items.find(item => item.name === 'Espresso Martini').description, undefined);
    const newItem = await call('/rairock/api/menu/requests', rairockOwner, 'POST',
      { name: 'Grilled Fish', category: 'Seafood', priceCents: 25000, sendsToKitchen: 1 });
    assert.equal(newItem.status, 201);
    const item = await newItem.json();
    assert.equal((await (await call('/api/menu', ambienteOwner)).json()).items.some((i) => i.name === 'Grilled Fish'), false);
    const rairockPos = await login('/rairock', 'pos', '2468');
    const sale = await call('/rairock/api/orders', rairockPos, 'POST', {
      clientId: 'rairock-test-order', station: 'cashier', createdAt: new Date().toISOString(),
      cashTenderedCents: 30000, items: [{ menuItemId: item.id, qty: 1 }],
    });
    assert.equal(sale.status, 201);
    const sold = await sale.json();
    assert.equal(sold.items[0].name, 'Grilled Fish');
    assert.equal(sold.total_cents, 25000);
    const rairockDay = await (await call('/rairock/api/admin/day', rairockOwner)).json();
    const ambienteDay = await (await call('/api/admin/day', ambienteOwner)).json();
    assert.equal(rairockDay.summary.order_count, 1);
    assert.equal(ambienteDay.summary.order_count, 0);
    const overview = await (await call('/api/admin/stores', ambienteOwner)).json();
    assert.equal(overview.stores.find((s) => s.id === 'rairock').summary.order_count, 1);
    assert.equal(overview.stores.find((s) => s.id === 'ambiente').summary.order_count, 0);
    const rairockKitchen = await login('/rairock', 'kitchen', '8765');
    const ambienteKitchen = await login('', 'kitchen', '4321');
    assert.equal((await (await call('/rairock/api/kitchen/tickets', rairockKitchen)).json()).length, 1);
    assert.equal((await (await call('/api/kitchen/tickets', ambienteKitchen)).json()).length, 0);
    assert.equal((await call('/rairock/pos')).headers.get('location'), '/rairock/login?role=pos');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
