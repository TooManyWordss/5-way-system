// The cloud site (Railway) helps the café tablet that runs its own server in Termux:
//   /tablet                       the one-line installer the tablet downloads
//   /api/admin/tablet-package     the app itself, for the installer (owner login needed)
//   /api/admin/tablet-link        a key the tablet uses to send backups and its internet link
//   /api/cafe-link/report|backup  what the tablet sends while the café internet is up
//   /cafe                         the owner's bookmark: opens the café tablet's admin from anywhere
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';
import { __dirname } from '../core/config.js';
import { DATA_DIR } from '../core/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { logActivity } from '../sales/orders.js';
import { app } from '../core/http.js';

// Everything the tablet runs: the server, the built screens, and the start script. No .env, no databases.
const PACKAGE_FILES = ['server.js', 'server', 'events.js', 'menu-catalog.js', 'menu-descriptions.js',
  'package.json', 'package-lock.json', 'dist', 'client/public', 'termux/start.sh'];
const BACKUPS_KEPT = 10;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function listFiles(rel) {
  const full = path.join(__dirname, rel);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [rel];
  return fs.readdirSync(full).filter((n) => n !== '.DS_Store').flatMap((n) => listFiles(path.join(rel, n)));
}

// A plain .tar.gz the tablet unpacks with `tar -xzf` (ustar format, files only).
function tarGz(files) {
  const blocks = [];
  for (const rel of files) {
    const data = fs.readFileSync(path.join(__dirname, rel));
    const name = rel.split(path.sep).join('/');
    const header = Buffer.alloc(512);
    const [prefix, base] = name.length > 100 ? [name.slice(0, name.lastIndexOf('/', 155)), name.slice(name.lastIndexOf('/', 155) + 1)] : ['', name];
    header.write(base, 0, 100);
    header.write(rel.endsWith('.sh') ? '0000755\0' : '0000644\0', 100);
    header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    header.write('        ', 148); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write(prefix, 345, 155);
    let sum = 0; for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

// The installer, with this site's address filled in.
app.get('/tablet', (req, res) => {
  const script = fs.readFileSync(path.join(__dirname, 'termux', 'install.sh'), 'utf8');
  res.type('text/plain').send(script.replaceAll('__CLOUD_URL__', `${req.protocol}://${req.get('host')}`));
});

app.get('/api/admin/tablet-package', (req, res) => {
  const files = PACKAGE_FILES.flatMap(listFiles);
  if (!files.some((f) => f.startsWith('dist'))) return res.status(503).json({ error: 'The screens are not built on this server' });
  res.type('application/gzip').send(tarGz(files));
});

// A new key replaces the old one, so only the most recently installed tablet can send.
app.post('/api/admin/tablet-link', (req, res) => {
  const token = crypto.randomBytes(32).toString('hex');
  setSetting('tablet_link_hash', sha256(token));
  logActivity(req, 'tablet.linked', 'Linked the café tablet for backups and remote access');
  res.json({ token });
});

function tabletOnly(req, res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const expected = getSetting('tablet_link_hash', '');
  if (!token || !expected || sha256(token) !== expected) return res.status(401).json({ error: 'Unknown tablet' });
  next();
}

app.post('/api/cafe-link/report', tabletOnly, (req, res) => {
  const url = req.body?.tunnelUrl;
  if (url && !/^https:\/\/[a-z0-9.-]+$/i.test(url)) return res.status(400).json({ error: 'Bad link' });
  if (url) setSetting('cafe_tunnel_url', url);
  setSetting('cafe_seen_at', new Date().toISOString());
  res.json({ ok: true });
});

app.post('/api/cafe-link/backup', tabletOnly, express.raw({ type: 'application/octet-stream', limit: '200mb' }), (req, res) => {
  const store = req.query.store === 'rairock' ? 'rairock' : 'ambiente';
  if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 15).toString() !== 'SQLite format 3') {
    return res.status(400).json({ error: 'Not a database file' });
  }
  const dir = path.join(DATA_DIR, 'cafe-backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${store}-${stamp}.db`), req.body);
  const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${store}-`)).sort().slice(0, -BACKUPS_KEPT);
  for (const f of old) fs.rmSync(path.join(dir, f));
  setSetting(`cafe_backup_at_${store}`, new Date().toISOString());
  res.json({ ok: true });
});

// The owner's bookmark. Opens the tablet's admin while the café is online; otherwise says when it was last seen.
app.get('/cafe', (req, res) => {
  const url = getSetting('cafe_tunnel_url', ''), seen = getSetting('cafe_seen_at', '');
  if (url && seen && Date.now() - Date.parse(seen) < 12 * 60_000) return res.redirect(`${url}/admin`);
  const when = (iso) => iso ? new Date(iso).toLocaleString('en-PH', { timeZone: process.env.TZ || 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Café tablet</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px;line-height:1.5">
<h1>The café tablet isn't reachable right now</h1>
<p>It connects here whenever the café has internet. Sales made in the meantime are kept on the tablet.</p>
<p>Last online: <strong>${when(seen)}</strong><br>Last backup: <strong>${when(getSetting('cafe_backup_at_ambiente', ''))}</strong></p>
<p><a href="/cafe">Try again</a></p></body>`);
});
