import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
export async function launch({ prepareData } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiente-dining-'));
  if (prepareData) await prepareData(dir);
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, DATA_DIR: dir, PORT: String(port), POS_PIN: '1234', BARISTA_PIN: '1234', INVENTORY_PIN: '1234', KITCHEN_PIN: '4321', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'dining-tests', TAX_RATE: '0.12', TZ: 'Asia/Manila' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output)), 15000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('5 Way System running')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}: ${output}`)); });
  });
  const request = async (url, cookie = '', body, method) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async role => (await request('/api/login', '', { role, secret: role === 'admin' ? 'test-password' : role === 'kitchen' ? '4321' : '1234' })).cookie;
  return { dir, child, base: `http://127.0.0.1:${port}`, request, login, async close() { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); } fs.rmSync(dir, { recursive: true, force: true }); } };
}
