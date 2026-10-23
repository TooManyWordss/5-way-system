import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { __dirname, currentStore, PAGE, storeContext } from './config.js';

// ---------- HTTP + WebSocket ----------

export const app = express();
export const httpServer = createServer(app);
export const io = new Server(httpServer);
export const storeBroadcast = (roles) => io.to((Array.isArray(roles) ? roles : [roles]).map((role) => `${currentStore()}:${role}`));
// How many of each screen are open right now in a store (each open screen is one live connection).
export const SCREEN_ROLES = ['pos', 'barista', 'kitchen', 'inventory', 'admin'];
export const screenCounts = (store = currentStore()) => Object.fromEntries(SCREEN_ROLES.map((role) => [role, io.sockets.adapter.rooms.get(`${store}:${role}`)?.size ?? 0]));
export const notifyOwnerOverview = () => { if (currentStore() === 'rairock') io.to('ambiente:admin').emit('stores.updated'); };

// Only set TRUST_PROXY when running behind a hosting proxy (it supplies the real client IP and HTTPS).
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// RaiRock's pages and API use /rairock/...; legacy Ambiente addresses remain valid.
app.use((req, res, next) => {
  const isRairock = req.url === '/rairock' || req.url.startsWith('/rairock/');
  req.store = isRairock ? 'rairock' : 'ambiente';
  if (isRairock) req.url = req.url.slice('/rairock'.length) || '/';
  storeContext.run(req.store, next);
});
app.use(express.json());

// Used by the hosting provider to check the app is up.
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/brand', (req, res, next) => express.static(path.join(__dirname, 'client', 'public', req.store === 'rairock' ? 'brands/rairock' : 'brand'))(req, res, next));
app.use('/fonts', express.static(path.join(__dirname, 'client', 'public', 'fonts')));
app.get('/:role.webmanifest', (req, res, next) => {
  const role = req.params.role;
  if (req.store !== 'rairock' || !Object.hasOwn(PAGE, role)) return next();
  const icon = '/rairock/brand/icon-512.png';
  res.type('application/manifest+json').json({
    name: `RaiRock Seafoods ${role.toUpperCase()}`,
    short_name: `RaiRock ${role}`,
    start_url: `/rairock/${role}`,
    scope: '/rairock/',
    display: role === 'kitchen' ? 'fullscreen' : 'standalone',
    orientation: 'landscape',
    background_color: '#F6F2E8',
    theme_color: '#08740C',
    icons: [{ src: icon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  });
});
app.use(express.static(path.join(__dirname, 'dist')));
app.get(['/login', '/login.html'], (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.get('/vendor/webauthn.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js')));
