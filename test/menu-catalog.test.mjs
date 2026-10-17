import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { menuCatalog } from '../menu-catalog.js';
import { getMenuDescription, withMenuDescription } from '../menu-descriptions.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('supplied menu has complete, distinct sellable options', () => {
  assert.equal(new Set(menuCatalog.map((item) => item.category)).size, 19);
  assert.equal(menuCatalog.length, 218);
  assert.equal(new Set(menuCatalog.map((item) => `${item.category}|${item.name}`)).size, menuCatalog.length);
  assert(menuCatalog.every((item) => item.name.length <= 60 && item.category.length <= 30 && item.priceCents > 0));
  assert.equal(menuCatalog.find((item) => item.name === 'Japanese Kobe A5 Wagyu Steak (per gram)')?.priceCents, 2000);
  for (const [category, count] of [['Seafood / Vegetables', 12], ['Pasta', 10], ['Pica-Pica / Soups', 13]]) {
    const items = menuCatalog.filter(item => item.category === category);
    assert.equal(items.length, count);
    assert(items.every(item => item.sendsToKitchen === 1));
  }
  for (const [name, price] of [['Chocolate Cake', 18100], ['Seafood Sotanghon', 38900], ['Whole Roasted Garlic Butter Shrimps', 49900], ['Spaghetti and Artisanal Meatballs', 49900], ['Extra Toast / Nachos / Dip / Egg', 3900]]) {
    assert.equal(menuCatalog.find(item => item.name === name)?.priceCents, price);
  }
});

test('every size and price option has a detailed description without inventing house recipes', () => {
  for (const item of menuCatalog) {
    assert(item.description?.length >= 100, `Missing detailed description: ${item.name}`);
    assert(item.descriptionNote?.length > 30, `Missing preparation qualification: ${item.name}`);
    assert(Array.isArray(item.descriptionSources));
    for (const source of item.descriptionSources) assert.equal(new URL(source.url).protocol, 'https:');
  }
  const find = (name, category) => menuCatalog.find(item => item.name === name && (!category || item.category === category));
  assert.equal(find('Cappuccino Frappe (16oz)').description, find('Cappuccino Frappe (20oz)').description);
  assert.notEqual(find('Barton & Guestier', 'White Wine').description, find('Barton & Guestier', 'Red Wine').description);
  assert.match(find('Velvet Dreams (16oz)').descriptionNote, /do not assume.*red velvet/i);
  assert.match(find('Fiesta Strips').description, /does not identify the main ingredient/);
  assert.match(find('Hot Tea Regular (Option 1)').descriptionNote, /Option 1 or Option 2/);
  assert.match(find('Japanese Kobe A5 Wagyu Steak (per gram)').description, /per gram/);
  assert.equal(find('Espresso Martini').descriptionSources[0].url, 'https://iba-world.com/iba-cocktail/espresso-martini/');
});

test('older API responses and offline caches receive all supplied descriptions in the client', () => {
  for (const item of menuCatalog) {
    const cached = { id: 42, name: item.name, category: item.category, price_cents: item.priceCents, available: 0 };
    const hydrated = withMenuDescription(cached, 'ambiente');
    assert.equal(hydrated.description, item.description, item.name);
    assert.equal(hydrated.available, 0);
    assert.equal(hydrated.price_cents, item.priceCents);
    assert.equal(cached.description, undefined, 'do not mutate cached data');
  }
  assert.match(getMenuDescription(' Frappe ', 'Cappuccino Frappe (16 oz)').description, /cappuccino/i);
  assert.match(getMenuDescription('Hot Coffee', 'Espresso (1 shot)').description, /One concentrated shot/);
  assert.match(getMenuDescription('Beef / Chicken', 'Japanese Kobe A5 Wagyu Steak (per gram)').description, /per gram/);
  const custom = { name: 'Cappuccino Frappe (16oz)', category: 'Frappe', description: 'Our approved house recipe.' };
  assert.equal(withMenuDescription(custom, 'ambiente').description, custom.description);
  assert.equal(withMenuDescription({ ...custom, description: '' }, 'rairock').description, `${custom.name} — Frappe.`);
});

test('startup updates menu once and keeps past order items', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiente-menu-'));
  const source = path.join(root, 'data.db');
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, 'data.db'));
  const before = fs.existsSync(source) ? new DatabaseSync(source, { readOnly: true }) : null;
  const oldOrderItems = before?.prepare('SELECT COUNT(*) AS n FROM order_items').get().n ?? 0;
  const oldMenuIds = before?.prepare("SELECT id FROM menu_items WHERE active = 1 AND status = 'approved' ORDER BY id").all().map((row) => row.id) ?? [];
  const oldVersion = before?.prepare("SELECT value FROM settings WHERE key = 'menu_catalog_version'").get()?.value;
  before?.close();
  const runServer = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, DATA_DIR: dir, PORT: '0', POS_PIN: '1234', KITCHEN_PIN: '1234', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-session-secret' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Server startup timed out: ${output}`)); }, 60000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('5 Way System running')) {
        clearTimeout(timer);
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => { clearTimeout(timer); output.includes('5 Way System running') ? resolve() : reject(new Error(`Server exited ${code}: ${output}`)); });
  });
  try {
    await runServer();
    await runServer();
    const db = new DatabaseSync(path.join(dir, 'data.db'), { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM menu_items WHERE active = 1 AND status = 'approved'").get().n, menuCatalog.length);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_items').get().n, oldOrderItems);
      assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'menu_catalog_version'").get().value, 'ambiente-2026-10-complete');
      if (['ambiente-2026-10', 'ambiente-2026-10-oz'].includes(oldVersion)) {
        const updatedIds = new Set(db.prepare("SELECT id FROM menu_items WHERE active = 1 AND status = 'approved'").all().map((row) => row.id));
        assert(oldMenuIds.every(id => updatedIds.has(id)), 'existing menu IDs must survive migration');
      }
      assert.equal(db.prepare("SELECT price_cents FROM menu_items WHERE name = 'Cappuccino Frappe (16oz)' AND active = 1").get().price_cents, 20900);
      assert.equal(db.prepare("SELECT price_cents FROM menu_items WHERE name = 'Chocolate Cake' AND active = 1").get().price_cents, 18100);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM menu_items WHERE category = 'Seafood / Vegetables' AND active = 1").get().n, 12);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
