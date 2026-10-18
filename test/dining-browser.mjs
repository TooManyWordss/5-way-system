import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { launch } from './support/server.mjs';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

test('owner password login tolerates older metrics and sidebar pages work on desktop and mobile', { timeout: 120000 }, async () => {
  const server = await launch(), browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/dining/metrics?*', async route => {
      const response = await route.fetch(), body = await response.json();
      delete body.previous; delete body.daily; delete body.previousFrom; delete body.previousTo;
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${server.base}/login?role=admin`);
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByRole('heading', { name: 'KPI dashboard', exact: true }).waitFor();
    await page.getByText('Comparison and daily trends unavailable.', { exact: false }).waitFor();
    await page.getByText('Net sales today', { exact: true }).waitFor();
    for (const [link, target] of [['Sales & receipts', '.day-nav'], ['Trends & events', '.perf'], ['Tables & menu', '.dining-admin'], ['Inventory', '.inv-open'], ['Staff & access', '.security']]) {
      await page.getByRole('navigation', { name: 'Admin pages' }).getByRole('link', { name: new RegExp(link) }).click();
      await page.locator(target).waitFor();
      assert.equal(await page.locator('.kpi-dashboard').count(), 0);
    }
    await page.reload(); await page.locator('.security').waitFor();
    await page.getByRole('navigation', { name: 'Admin pages' }).getByRole('link', { name: 'Overview', exact: false }).click();
    await page.locator('.kpi-cards').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if(process.env.DINING_SCREENSHOT_DIR){fs.mkdirSync(process.env.DINING_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.DINING_SCREENSHOT_DIR,'owner-mobile.png'),fullPage:true});}
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

test('tablet POS survives offline reload and an interrupted payment response without duplicate receipts', { timeout: 120000 }, async () => {
  const server = await launch(), browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await context.request.post(`${server.base}/api/login`, { data: { role: 'admin', secret: 'test-password' } });
    const seed = { id: 'seed-table', deviceId: 'browser-test', type: 'table.save', targetId: 'browser-table', expectedVersion: 0, at: new Date().toISOString(), payload: { name: 'Browser Garden', active: true } };
    assert.equal((await context.request.post(`${server.base}/api/dining/sync`, { data: { operations: [seed] } })).status(), 200);
    const snapshot = await (await context.request.get(`${server.base}/api/dining/state`)).json();
    const item = snapshot.menu.find(m => m.available && m.sends_to_kitchen);
    await page.goto(`${server.base}/pos`);
    await page.getByRole('button', { name: 'Tables', exact: true }).click();
    await page.getByRole('button', { name: /Browser Garden.*Available/ }).click();
    await page.getByLabel('Guests', { exact: true }).fill('3');
    await page.getByLabel('Guest alias (optional)').fill('Browser party');
    await page.getByRole('button', { name: 'Seat guests', exact: true }).click();
    await page.getByRole('heading', { name: /Browser Garden/ }).waitFor();
    await page.getByLabel('Search table menu').fill(item.name);
    await page.locator('.dining-menu button').filter({ hasText: item.name }).first().click();
    await page.locator('.dining-draft-line input[type=number]').fill('2');
    await page.locator('.dining-draft-line input').last().fill('Sauce aside');
    await page.getByRole('button', { name: 'Send order to kitchen', exact: true }).click();
    await page.getByText('0 unsynced action(s)', { exact: true }).waitFor();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await page.getByText('Offline / connecting', { exact: true }).waitFor();
    await page.getByLabel('Search table menu').fill(item.name);
    await page.locator('.dining-menu button').filter({ hasText: item.name }).first().click();
    await page.getByRole('button', { name: 'Send order to kitchen', exact: true }).click();
    await page.getByRole('button', { name: 'Start eating', exact: true }).click();
    await page.getByRole('button', { name: 'Finish eating', exact: true }).click();
    await page.getByRole('button', { name: 'Request bill', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Tables', exact: true }).click();
    await page.getByRole('button', { name: /Browser Garden.*Browser party/ }).click();
    assert.equal(await page.locator('.dining-submission').count(), 2);
    assert.match(await page.locator('.dining-sync').innerText(), /4 unsynced/);
    await page.getByRole('button', { name: 'Exact', exact: true }).click();
    await page.getByRole('button', { name: 'Settle cash bill', exact: true }).click();
    await page.getByText('PROVISIONAL · awaiting synchronization', { exact: true }).waitFor();

    let interrupted = false;
    await page.route('**/api/dining/sync', async route => { await route.fetch(); interrupted = true; await route.abort('failed'); });
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dining-sync')?.textContent?.includes('Offline / connecting'));
    // The server committed the cash bill, but the browser did not receive its acknowledgment.
    for (let n = 0; !interrupted && n < 30; n++) await page.waitForTimeout(100);
    assert.equal(interrupted, true);
    let report = await (await context.request.get(`${server.base}/api/admin/day`)).json();
    assert.equal(report.summary.order_count, 1);
    await page.unroute('**/api/dining/sync');
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await page.getByText('0 unsynced action(s)', { exact: true }).waitFor();
    assert.match(await page.locator('.dining-bill').innerText(), /Receipt #1001/);
    report = await (await context.request.get(`${server.base}/api/admin/day`)).json();
    assert.equal(report.summary.order_count, 1);
    assert.equal(report.orders[0].items.reduce((n, l) => n + l.qty, 0), 3);
    const rootBounds = await page.locator('.dining-workspace').boundingBox();
    assert.ok(rootBounds.width > 950, 'Tables should use the full tablet width');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.dining-print').isVisible(), true);
    assert.equal(await page.locator('.dining-print').evaluate(el => getComputedStyle(el.parentElement.parentElement.parentElement).display === 'none'), false);
    await page.emulateMedia({ media: 'screen' });
    // The existing counter till shares the manual discount rules and audited undo.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.locator('.menu-item').filter({ hasText: item.name }).first().click();
    await page.locator('.pos-cart .qty button').last().click();
    await page.locator('.cart-head').getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.locator('.pos-cart .qty span').innerText(), '1');
    await page.getByRole('button', { name: 'Discount', exact: true }).click();
    await page.getByLabel('Amount / percent').fill('20');
    await page.locator('.sheet select[name=label]').selectOption('Senior');
    await page.getByLabel('Reason', { exact: true }).fill('Staff-entered senior concession');
    await page.getByRole('button', { name: 'Apply discount', exact: true }).click();
    await page.getByRole('button', { name: 'Exact', exact: true }).click();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    await page.getByRole('button', { name: 'Undo saved action', exact: true }).waitFor();
    report = await (await context.request.get(`${server.base}/api/admin/day`)).json();
    assert.equal(report.summary.order_count, 2);
    assert.equal(report.orders.find(o => !o.visit_id).discount_cents, Math.round(item.price_cents * 0.2));
    await page.getByRole('button', { name: 'Undo saved action', exact: true }).click();
    await page.locator('.dining-global-undo').getByRole('status').waitFor();
    assert.match(await page.locator('.dining-global-undo').innerText(), /Return/);
    report = await (await context.request.get(`${server.base}/api/admin/day`)).json();
    assert.equal(report.summary.order_count, 1);
    await page.getByRole('button', { name: 'Tables', exact: true }).click();
    await page.getByRole('button', { name: /Browser Garden.*Browser party/ }).click();
    // Kitchen actions are also durable while disconnected, including after reload.
    const kitchenContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await kitchenContext.request.post(`${server.base}/api/login`, { data: { role: 'kitchen', secret: '4321' } });
    const kitchenPage = await kitchenContext.newPage(); kitchenPage.on('pageerror', e => errors.push(e.message));
    await kitchenPage.goto(`${server.base}/kitchen`);
    await kitchenPage.locator('.start-overlay').click();
    await kitchenPage.locator('.dining-kitchen .ticket').first().waitFor();
    assert.equal(await kitchenPage.locator('.dining-kitchen .ticket').count(), 2);
    await kitchenPage.evaluate(async () => { await navigator.serviceWorker.ready; });
    await kitchenPage.waitForFunction(() => !!navigator.serviceWorker.controller);
    await kitchenContext.setOffline(true);
    await kitchenPage.getByRole('button', { name: '+ ready', exact: true }).first().click();
    await kitchenPage.getByText('1 unsynced action(s)', { exact: true }).waitFor();
    await kitchenPage.reload();
    await kitchenPage.locator('.start-overlay').click();
    await kitchenPage.getByText('1 unsynced action(s)', { exact: true }).waitFor();
    assert.match(await kitchenPage.locator('.ticket').first().innerText(), /1 \/ 2 ready/);
    await kitchenContext.setOffline(false);
    await kitchenPage.getByRole('button', { name: 'Sync now', exact: true }).click();
    await kitchenPage.getByText('0 unsynced action(s)', { exact: true }).waitFor();
    const afterKitchen = await (await context.request.get(`${server.base}/api/dining/state`)).json();
    assert.equal(Object.values(afterKitchen.visits)[0].submissions[0].lines[0].ready_qty, 1);
    await kitchenContext.close();
    const screenshotDir=process.env.DINING_SCREENSHOT_DIR??path.join(server.dir,'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, 'tablet-visit.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); await server.close(); }
});

test('two offline tablets retain competing parties and cash bills through owner reconciliation', { timeout: 120000 }, async () => {
  const server = await launch(), browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ownerContext.request.post(`${server.base}/api/login`, { data: { role: 'admin', secret: 'test-password' } });
    const ops = ['Shared', 'Patio'].map(name => ({ id: `seed-${name}`, deviceId: 'seed', type: 'table.save', targetId: name, expectedVersion: 0, at: new Date().toISOString(), payload: { name, active: true } }));
    await ownerContext.request.post(`${server.base}/api/dining/sync`, { data: { operations: ops } });
    const state = await (await ownerContext.request.get(`${server.base}/api/dining/state`)).json(), item = state.menu.find(m => m.available && m.sends_to_kitchen);
    const contexts = [], pages = [];
    for (const name of ['Party A', 'Party B']) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 } }); contexts.push(context);
      await context.request.post(`${server.base}/api/login`, { data: { role: 'pos', secret: '1234' } });
      const page = await context.newPage(); pages.push(page);
      await page.goto(`${server.base}/pos`); await page.getByRole('button', { name: 'Tables', exact: true }).click();
      await page.getByRole('button', { name: /^Shared Available/ }).waitFor();
      await context.setOffline(true);
      await page.getByRole('button', { name: /^Shared Available/ }).click();
      await page.getByLabel('Guest alias (optional)').fill(name);
      await page.getByRole('button', { name: 'Seat guests', exact: true }).click();
      await page.getByLabel('Search table menu').fill(item.name);
      await page.locator('.dining-menu button').filter({ hasText: item.name }).first().click();
      await page.getByRole('button', { name: 'Send order to kitchen', exact: true }).click();
      await page.getByRole('button', { name: 'Request bill', exact: true }).click();
      await page.getByRole('button', { name: 'Exact', exact: true }).click();
      await page.getByRole('button', { name: 'Settle cash bill', exact: true }).click();
      await page.getByText('PROVISIONAL · awaiting synchronization', { exact: true }).waitFor();
    }
    await contexts[0].setOffline(false); await pages[0].getByRole('button', { name: 'Sync now', exact: true }).click();
    await pages[0].getByText('0 unsynced action(s)', { exact: true }).waitFor();
    await contexts[1].setOffline(false); await pages[1].getByRole('button', { name: 'Sync now', exact: true }).click();
    await pages[1].getByText('Some actions need owner review.', { exact: false }).waitFor();
    const owner = await ownerContext.newPage(); await owner.goto(`${server.base}/admin`);
    await owner.getByRole('heading', { name: 'KPI dashboard', exact: true }).waitFor();
    await owner.locator('.kpi-cards').waitFor();
    await owner.getByRole('button', { name: 'Today', exact: true }).click();
    await owner.locator('.kpi-dashboard[aria-busy=false]').waitFor();
    assert.equal(await owner.locator('.kpi-trend').count(), 2);
    assert.equal(await owner.locator('.kpi-times .kpi-card').count(), 5);
    if(process.env.DINING_SCREENSHOT_DIR){fs.mkdirSync(process.env.DINING_SCREENSHOT_DIR,{recursive:true});await owner.locator('.kpi-dashboard').screenshot({path:path.join(process.env.DINING_SCREENSHOT_DIR,'kpi-dashboard.png')});}
    await owner.getByRole('link', { name: /Tables & menu/ }).click();
    await owner.locator('.dining-conflict').first().waitFor();
    assert.equal(await owner.locator('.dining-conflict').count(), 4);
    for (const [type, remaining] of [['table.seat', 3], ['visit.submit', 2], ['visit.event', 1], ['visit.settle', 0]]) {
      const form = owner.locator('.dining-conflict').filter({ has: owner.getByRole('heading', { name: new RegExp(`^${type}`) }) });
      if (type === 'table.seat') await form.getByLabel('Table for this party').selectOption('Patio');
      await form.getByLabel('Resolution / cash handling note').fill(`Confirmed separate parties; moved Party B to Patio; ${type}; retained cash, no correction needed.`);
      await form.getByRole('checkbox').check();
      await form.getByRole('button', { name: 'Record resolution', exact: true }).click();
      await owner.waitForFunction(n => document.querySelectorAll('.dining-conflict').length === n, remaining);
    }
    await pages[1].getByRole('button', { name: 'Sync now', exact: true }).click();
    await pages[1].getByText('0 unsynced action(s)', { exact: true }).waitFor();
    const report = await (await ownerContext.request.get(`${server.base}/api/admin/day`)).json();
    assert.equal(report.summary.order_count, 2);
    const finalState = await (await ownerContext.request.get(`${server.base}/api/dining/state`)).json();
    assert.equal(Object.values(finalState.visits).filter(v => v.status === 'settled').length, 2);
    assert.equal(new Set(Object.values(finalState.visits).map(v => v.table_id)).size, 2);
    assert.ok(Object.values(finalState.visits).every(v => v.cash_cents > 0));
    const history = await (await ownerContext.request.get(`${server.base}/api/dining/history`)).json();
    assert.equal(history.filter(r => r.resolution).length, 4);
    if(process.env.DINING_SCREENSHOT_DIR){fs.mkdirSync(process.env.DINING_SCREENSHOT_DIR,{recursive:true});await owner.locator('.dining-admin').screenshot({path:path.join(process.env.DINING_SCREENSHOT_DIR,'owner-table-service.png')});}
    for (const context of contexts) await context.close();
    await ownerContext.close();
  } finally { await browser.close(); await server.close(); }
});
