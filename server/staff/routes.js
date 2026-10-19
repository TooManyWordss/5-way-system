import crypto from 'node:crypto';
import { secretFor } from '../auth/secrets.js';
import { db } from '../core/db.js';
import { pinAllowed, setSetting } from '../core/settings.js';
import { logActivity } from '../sales/orders.js';
import { app, io } from '../core/http.js';
import { makeSetupCode, ROLE_LABEL, setupCodes } from '../passkeys/routes.js';

// ---------- Admin: staff and sign-in settings ----------

app.get('/api/admin/security', (req, res) => {
  const staff = db
    .prepare(
      `SELECT s.id, s.name, s.role, s.created_at, COUNT(p.id) AS passkeys, MAX(p.last_used_at) AS last_used_at
         FROM staff s LEFT JOIN passkeys p ON p.staff_id = s.id
        WHERE s.active = 1 GROUP BY s.id ORDER BY s.role, s.name`
    )
    .all();
  const passkeys = db
    .prepare('SELECT id, staff_id, role, device, created_at, last_used_at FROM passkeys ORDER BY created_at')
    .all();
  res.json({ staff, passkeys, pin: pinSettings(), pinSet: Object.fromEntries(PIN_ROLES.map((role) => [role, !!secretFor(role)])) });
});

app.post('/api/admin/staff', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const role = req.body?.role;
  if (!name || name.length > 40) return res.status(400).json({ error: 'Name must be 1–40 characters' });
  if (!['pos', 'barista', 'kitchen', 'inventory'].includes(role)) return res.status(400).json({ error: 'Choose cashier, barista, kitchen or inventory' });
  if (db.prepare('SELECT 1 FROM staff WHERE lower(name) = lower(?) AND active = 1').get(name)) {
    return res.status(400).json({ error: `${name} is already on the staff list` });
  }
  const id = Number(db.prepare('INSERT INTO staff (name, role, created_at) VALUES (?, ?, ?)').run(name, role, new Date().toISOString()).lastInsertRowid);
  logActivity(req, 'staff.added', `Added ${name} (${ROLE_LABEL[role]})`);
  res.status(201).json({ id, name, role, ...makeSetupCode(id) });
});

app.post('/api/admin/staff/:id/code', (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });
  res.json({ name: staff.name, ...makeSetupCode(staff.id) });
});

// Removing someone signs them out everywhere straight away and deletes their passkeys.
app.delete('/api/admin/staff/:id', (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });
  db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(staff.id);
  db.prepare('DELETE FROM passkeys WHERE staff_id = ?').run(staff.id);
  for (const [code, c] of setupCodes) if (c.store === req.store && c.staffId === staff.id) setupCodes.delete(code);
  logActivity(req, 'staff.removed', `Removed ${staff.name}`);
  for (const socket of io.sockets.sockets.values()) if (socket.data.staffId === staff.id) socket.disconnect(true);
  res.json({ ok: true });
});

app.delete('/api/admin/passkeys/:id', (req, res) => {
  const result = db.prepare('DELETE FROM passkeys WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Already removed' });
  logActivity(req, 'passkey.removed', 'Removed a fingerprint / Face ID sign-in');
  res.json({ ok: true });
});

// Shared PINs per staff screen: owner changes override the initial .env value.
export const PIN_ROLES = ['pos', 'barista', 'kitchen', 'inventory'];
export const pinSettings = () => Object.fromEntries(PIN_ROLES.map((role) => [role, pinAllowed(role)]));

app.post('/api/admin/pins/:role', (req, res) => {
  const role = req.params.role;
  const pin = req.body?.pin;
  if (!PIN_ROLES.includes(role)) return res.status(400).json({ error: 'Choose a staff screen' });
  if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4 to 12 digits' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  setSetting(`pin_${role}_hash`, `scrypt:${salt}:${hash}`);
  logActivity(req, 'settings.changed', `Changed the shared ${ROLE_LABEL[role].toLowerCase()} PIN`);
  res.json({ ok: true });
});

// Turn a shared staff-screen PIN on or off.
app.post('/api/admin/sign-in-settings', (req, res) => {
  for (const role of PIN_ROLES) {
    if (typeof req.body?.[role] !== 'boolean') continue;
    setSetting(`pin_${role}`, req.body[role] ? '1' : '0');
    logActivity(req, 'settings.changed', `${req.body[role] ? 'Allowed' : 'Turned off'} the shared ${ROLE_LABEL[role].toLowerCase()} PIN`);
  }
  res.json(pinSettings());
});
