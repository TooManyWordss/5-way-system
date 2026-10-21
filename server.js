// Central backend: the POS sends orders here, the server saves them,
// then broadcasts them live to the kitchen display and the admin panel.
// Each feature lives in its own folder under server/ and adds its routes when imported,
// in the same order as before, so the login checks run before the routes they protect.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __dirname, PORT, storeContext } from './server/core/config.js';
import { readSession } from './server/auth/sessions.js';
import { databases } from './server/core/db.js';
import './server/core/init.js';
import { app, httpServer, io } from './server/core/http.js';
import './server/auth/routes.js';
import './server/dining.js';
import './server/passkeys/routes.js';
import './server/staff/routes.js';
import './server/menu/routes.js';
import './server/inventory/routes.js';
import './server/tables/routes.js';
import './server/sales/routes.js';
import './server/kitchen/routes.js';
import './server/admin/routes.js';
import './server/cloud/routes.js';
import './server/cloud/tablet.js';

// React client routes fall through to Vite's built entry point. API misses stay JSON 404s.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const entry = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(entry)) return res.sendFile(entry);
  res.status(503).send('Frontend is not built yet. Run npm run build.');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Live updates need a login too. Each screen joins a room named after its role,
// and each broadcast above names the rooms that need it.
io.use((socket, next) => {
  const store = socket.handshake.auth?.store === 'rairock' ? 'rairock' : 'ambiente';
  const session = storeContext.run(store, () => readSession(socket.handshake.headers.cookie));
  if (!session) return next(new Error('unauthorized'));
  socket.data.store = store;
  socket.data.role = session.role;
  socket.data.staffId = session.staff?.id ?? 0;
  next();
});
io.on('connection', (socket) => socket.join(`${socket.data.store}:${socket.data.role}`));

// Close the database cleanly when stopped or restarted (npm run dev restarts on every edit),
// so the next start never finds it locked.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    io.close();
    httpServer.close();
    for (const database of Object.values(databases)) database.close();
    process.exit(0);
  });
}

httpServer.listen(PORT, () => {
  // Addresses the iPad and kitchen screen can use on the same Wi-Fi.
  // Android (when the server runs on a tablet in Termux) may refuse to list them; the server runs anyway.
  let lanHosts = [];
  try {
    lanHosts = Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a?.family === 'IPv4' && !a.internal)
      .map((a) => a.address);
  } catch {
    console.log('  (This device does not list its network address. Find it under Wi-Fi settings → the network → IP address.)');
  }
  console.log(`5 Way System running on port ${PORT}`);
  for (const host of ['localhost', ...lanHosts]) {
    console.log(`  http://${host}:${PORT}   (Ambiente: /pos, /admin · RaiRock: /rairock/pos, /rairock/admin)`);
  }
});
