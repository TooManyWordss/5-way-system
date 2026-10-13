import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { menuCatalog } from '../menu-catalog.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('supplied menu has complete, distinct sellable options', () => {
  assert.equal(new Set(menuCatalog.map((item) => item.category)).size, 16);
  assert.equal(menuCatalog.length, 183);
  assert.equal(new Set(menuCatalog.map((item) => `${item.category}|${item.name}`)).size, menuCatalog.length);
  assert(menuCatalog.every((item) => item.name.length <= 60 && item.category.length <= 30 && item.priceCents > 0));
  assert.equal(menuCatalog.find((item) => item.name === 'Japanese Kobe A5 Wagyu Steak (per gram)')?.priceCents, 2000);
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
      assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'menu_catalog_version'").get().value, 'ambiente-2026-10-oz');
      if (oldVersion === 'ambiente-2026-10') {
        assert.deepEqual(db.prepare("SELECT id FROM menu_items WHERE active = 1 AND status = 'approved' ORDER BY id").all().map((row) => row.id), oldMenuIds);
      }
      assert.equal(db.prepare("SELECT price_cents FROM menu_items WHERE name = 'Cappuccino Frappe (16oz)' AND active = 1").get().price_cents, 20900);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
