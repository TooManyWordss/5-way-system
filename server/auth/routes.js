import path from 'node:path';
import { __dirname, PAGE, STOCK_KEEPERS, storePath } from '../core/config.js';
import { matchesSecret, secretFor } from './secrets.js';
import { can, isRole, loginFailures, readSession, requireRole, SELLERS, sessionCookie, startSession } from './sessions.js';
import { pinAllowed } from '../core/settings.js';
import { app } from '../core/http.js';

for (const [role, page] of Object.entries(PAGE)) {
  app.get(`/${role}`, (req, res) => {
    const current = readSession(req.headers.cookie);
    if (current && can(current.role, role)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
    res.redirect(storePath(req, `/login?role=${role}`));
  });
}

app.post('/api/login', (req, res) => {
  const { role, secret } = req.body ?? {};
  if (!isRole(role)) return res.status(400).json({ error: 'Unknown screen' });
  if (!pinAllowed(role)) return res.status(403).json({ error: 'PIN sign-in is turned off. Use Face ID or fingerprint.' });
  if (!secretFor(role)) return res.status(403).json({ error: 'No PIN is set for this screen. Use Face ID or fingerprint, or ask the owner.' });

  const key = `${req.store}|${req.ip}|${role}`;
  const failure = loginFailures.get(key);
  if (failure?.lockedUntil > Date.now()) {
    const minutes = Math.ceil((failure.lockedUntil - Date.now()) / 60_000);
    return res.status(429).json({ error: `Too many wrong attempts. Try again in ${minutes} min.` });
  }

  if (!matchesSecret(role, secret)) {
    const count = (failure?.count ?? 0) + 1;
    loginFailures.set(key, count >= 5 ? { count: 0, lockedUntil: Date.now() + 5 * 60_000 } : { count });
    return res.status(401).json({ error: role === 'admin' ? 'Wrong password' : 'Wrong PIN' });
  }

  loginFailures.delete(key);
  startSession(req, res, role);
  res.json({ role, home: storePath(req, `/${role}`) });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ ok: true });
});

app.use('/api/menu', requireRole(...SELLERS));
app.use('/api/pos', requireRole(...SELLERS));
app.use('/api/kitchen', requireRole('kitchen'));
app.use('/api/inventory', requireRole(...STOCK_KEEPERS));
app.use('/api/admin', requireRole('admin'));
