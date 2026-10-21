// Runs only on the café tablet (Termux), when the installer has linked it to the cloud site
// (CLOUD_URL and CLOUD_TOKEN in .env). While the café internet is up it:
//   - sends a copy of the sales databases every 30 minutes, so a broken tablet loses nothing
//   - opens a secure internet link (cloudflared) and tells the cloud site, so the owner's
//     bookmark <cloud>/cafe opens this tablet's admin from anywhere.
// Without internet nothing here matters: the POS and kitchen keep working over the café Wi-Fi.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORT } from '../core/config.js';
import { databases } from '../core/db.js';

const { CLOUD_URL, CLOUD_TOKEN, TUNNEL } = process.env;
const BACKUP_EVERY = 30 * 60_000, REPORT_EVERY = 5 * 60_000;
let tunnelUrl = null;

const send = (route, body, type = 'application/json') => fetch(`${CLOUD_URL}${route}`, {
  method: 'POST', headers: { Authorization: `Bearer ${CLOUD_TOKEN}`, 'Content-Type': type },
  body: type === 'application/json' ? JSON.stringify(body) : body, signal: AbortSignal.timeout(60_000),
});

async function backup() {
  for (const [store, database] of Object.entries(databases)) {
    const file = path.join(os.tmpdir(), `cafe-backup-${store}.db`);
    try {
      fs.rmSync(file, { force: true });
      database.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`); // a consistent copy, even mid-sale
      const res = await send(`/api/cafe-link/backup?store=${store}`, fs.readFileSync(file), 'application/octet-stream');
      if (!res.ok) console.log(`Backup of ${store} not accepted (${res.status})`);
    } catch { /* no internet right now; the next round tries again */ }
    finally { fs.rmSync(file, { force: true }); }
  }
}

async function report() {
  try { await send('/api/cafe-link/report', { tunnelUrl }); } catch { /* offline */ }
}

function startTunnel() {
  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const watch = (chunk) => {
    const found = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (found && found[0] !== tunnelUrl) { tunnelUrl = found[0]; console.log(`Owner link is up (opens from ${CLOUD_URL}/cafe)`); void report(); }
  };
  child.stdout.on('data', watch); child.stderr.on('data', watch);
  let missing = false;
  child.on('error', () => { missing = true; console.log('cloudflared is not installed; remote owner access is off.'); });
  child.on('close', () => { tunnelUrl = null; if (!missing) setTimeout(startTunnel, 30_000); }); // e.g. internet dropped; try again
}

if (CLOUD_URL && CLOUD_TOKEN) {
  setTimeout(() => void backup(), 60_000);
  setInterval(() => void backup(), BACKUP_EVERY);
  setInterval(() => void report(), REPORT_EVERY);
  if (TUNNEL === '1') startTunnel();
}
