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

test('a screen checks the current session role and protected pages are not cached', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiente-session-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), POS_PIN: '1234', KITCHEN_PIN: '4321', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-session-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 15000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('5 Way System running')) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    for (const role of ['pos', 'barista', 'kitchen', 'inventory', 'admin']) {
      const protectedPage = await fetch(`${base}/${role}`, { redirect: 'manual' });
      assert.equal(protectedPage.status, 302);
      assert.equal(protectedPage.headers.get('location'), `/login?role=${role}`);
      assert.equal((await fetch(`${base}/login?role=${role}`)).status, 200);
    }
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'pos', secret: '1234' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const ownScreen = await fetch(`${base}/api/me?role=pos`, { headers: { cookie } });
    assert.equal(ownScreen.status, 200);
    assert.equal(ownScreen.headers.get('cache-control'), 'no-store');
    assert.equal((await ownScreen.json()).role, 'pos');
    assert.equal((await fetch(`${base}/api/me?role=admin`, { headers: { cookie } })).status, 401);
    const page = await fetch(`${base}/pos`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
