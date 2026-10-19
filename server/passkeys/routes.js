import crypto from 'node:crypto';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { currentStore, storePath, STORES } from '../core/config.js';
import { secretFor } from '../auth/secrets.js';
import { can, isRole, loginFailures, readSession, requireRole, startSession } from '../auth/sessions.js';
import { db } from '../core/db.js';
import { pinAllowed } from '../core/settings.js';
import { logActivity } from '../sales/orders.js';
import { app, storeBroadcast } from '../core/http.js';

// ---------- Face ID, Touch ID and fingerprint (passkeys) ----------
// The device checks the face or finger; the server only checks a signature against the
// public key saved when the device was registered. Browsers allow this on HTTPS (or localhost) only.

export const ROLE_LABEL = { admin: 'Owner', pos: 'Cashier', barista: 'Barista', kitchen: 'Kitchen', inventory: 'Inventory' };

// Passkeys belong to one web address. RP_ID / RP_ORIGIN override it when needed.
export function relyingParty(req) {
  return {
    rpID: process.env.RP_ID || req.hostname,
    origin: process.env.RP_ORIGIN || `${req.protocol}://${req.get('host')}`,
  };
}

// Each sign-in or setup attempt gets a one-time challenge, valid for 5 minutes.
export const challenges = new Map(); // id -> { challenge, expires, ...details }
export function rememberChallenge(challenge, details = {}) {
  for (const [id, c] of challenges) if (c.expires < Date.now()) challenges.delete(id);
  const id = crypto.randomBytes(16).toString('base64url');
  challenges.set(id, { challenge, expires: Date.now() + 5 * 60_000, store: currentStore(), ...details });
  return id;
}
export function takeChallenge(id) {
  const c = challenges.get(id);
  challenges.delete(id);
  return c && c.store === currentStore() && c.expires > Date.now() ? c : null;
}

// Setup codes: the owner makes one for a staff member, who types it on their tablet once.
export const setupCodes = new Map(); // code -> { staffId, expires }
export function makeSetupCode(staffId) {
  for (const [code, c] of setupCodes) if ((c.store === currentStore() && c.staffId === staffId) || c.expires < Date.now()) setupCodes.delete(code);
  const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
  const expires = Date.now() + 15 * 60_000;
  setupCodes.set(code, { staffId, expires, store: currentStore() });
  return { code, expiresAt: new Date(expires).toISOString() };
}

export const transportsOf = (row) => (row.transports ? JSON.parse(row.transports) : undefined);

export async function registrationOptions(req, { role, staff }) {
  const name = staff ? staff.name : 'Owner';
  const existing = db.prepare('SELECT id, transports FROM passkeys WHERE role = ? AND staff_id IS ?').all(role, staff?.id ?? null);
  const options = await generateRegistrationOptions({
    rpName: STORES[currentStore()].name,
    rpID: relyingParty(req).rpID,
    userName: `${name} (${ROLE_LABEL[role]})`,
    userDisplayName: name,
    userID: new TextEncoder().encode(staff ? `staff-${staff.id}` : 'owner'),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: transportsOf(p) })), // same device twice
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { options, challengeId: rememberChallenge(options.challenge, { purpose: 'register', role, staffId: staff?.id ?? null }) };
}

// Which sign-in methods the login page should offer for a screen.
app.get('/api/login-options', (req, res) => {
  const role = isRole(req.query.role) ? req.query.role : 'admin';
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM passkeys p LEFT JOIN staff s ON s.id = p.staff_id
        WHERE (p.role = ? OR p.role = 'admin') AND (p.staff_id IS NULL OR s.active = 1)`
    )
    .get(role);
  res.json({ pin: pinAllowed(role) && !!secretFor(role), passkeys: n > 0 });
});

// Who is signed in on this device.
app.get('/api/me', (req, res) => {
  const session = readSession(req.headers.cookie);
  const requestedRole = req.query.role;
  res.setHeader('Cache-Control', 'no-store');
  if (!session || (requestedRole && (!isRole(requestedRole) || !can(session.role, requestedRole)))) {
    return res.status(401).json({ error: 'Please log in' });
  }
  res.json({ role: session.role, name: session.staff?.name ?? null });
});

// Staff, step 1: the setup code from the owner starts registering this device.
app.post('/api/passkeys/setup', async (req, res) => {
  const key = `${req.store}|${req.ip}|setup`;
  const failure = loginFailures.get(key);
  if (failure?.lockedUntil > Date.now()) return res.status(429).json({ error: 'Too many wrong codes. Try again in a few minutes.' });

  const entry = setupCodes.get(String(req.body?.code ?? '').replace(/\D/g, ''));
  const staff = entry && entry.store === req.store && entry.expires > Date.now()
    ? db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(entry.staffId)
    : null;
  if (!staff) {
    const count = (failure?.count ?? 0) + 1;
    loginFailures.set(key, count >= 5 ? { count: 0, lockedUntil: Date.now() + 5 * 60_000 } : { count });
    return res.status(400).json({ error: 'That code is wrong or has expired. Ask the owner for a new one.' });
  }
  loginFailures.delete(key);
  const { options, challengeId } = await registrationOptions(req, { role: staff.role, staff });
  challenges.get(challengeId).code = String(req.body.code).replace(/\D/g, '');
  res.json({ options, challengeId, name: staff.name });
});

// Owner, step 1: add Face ID / Touch ID on the device the owner is using now.
app.post('/api/admin/passkeys/options', requireRole('admin'), async (req, res) => {
  res.json(await registrationOptions(req, { role: 'admin', staff: null }));
});

// Step 2 for both: save the new passkey. Staff are signed in straight away.
app.post('/api/passkeys/register', async (req, res) => {
  const c = takeChallenge(req.body?.challengeId);
  if (!c || c.purpose !== 'register') return res.status(400).json({ error: 'Setup timed out. Start again.' });
  if (c.role === 'admin' && readSession(req.headers.cookie)?.role !== 'admin') return res.status(401).json({ error: 'Please log in' });
  if (c.staffId && setupCodes.get(c.code)?.store !== req.store) return res.status(400).json({ error: 'That code was already used or has expired.' });

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: c.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not set up: ${err.message}` });
  }
  if (!verification.verified) return res.status(400).json({ error: 'Could not set up this device' });

  const { credential } = verification.registrationInfo;
  const device = typeof req.body.device === 'string' ? req.body.device.slice(0, 40) : null;
  db.prepare(
    `INSERT INTO passkeys (id, staff_id, role, public_key, counter, transports, device, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(credential.id, c.staffId, c.role, credential.publicKey, credential.counter,
    credential.transports ? JSON.stringify(credential.transports) : null, device, new Date().toISOString());

  if (c.staffId) {
    setupCodes.delete(c.code);
    const staff = db.prepare('SELECT id, name, role FROM staff WHERE id = ?').get(c.staffId);
    logActivity({ role: staff.role, staff }, 'passkey.added', `${staff.name} set up fingerprint / Face ID sign-in${device ? ` on ${device}` : ''}`);
    startSession(req, res, staff.role, staff.id);
    storeBroadcast('admin').emit('security.updated');
    return res.json({ home: storePath(req, `/${staff.role}`), name: staff.name });
  }
  logActivity({ role: 'admin' }, 'passkey.added', `Owner set up fingerprint / Face ID sign-in${device ? ` on ${device}` : ''}`);
  res.json({ ok: true });
});

// Sign in, step 1: the device shows its Face ID / fingerprint prompt and the passkeys it has.
app.post('/api/passkeys/login/options', async (req, res) => {
  const options = await generateAuthenticationOptions({ rpID: relyingParty(req).rpID, userVerification: 'required' });
  res.json({ options, challengeId: rememberChallenge(options.challenge, { purpose: 'login' }) });
});

// Sign in, step 2: check the signature, then open the screen as that person.
app.post('/api/passkeys/login', async (req, res) => {
  const { challengeId, response, role } = req.body ?? {};
  const c = takeChallenge(challengeId);
  if (!c || c.purpose !== 'login') return res.status(400).json({ error: 'Sign-in timed out. Try again.' });
  const wanted = isRole(role) ? role : 'admin';

  const passkey = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id ?? ''));
  if (!passkey) return res.status(401).json({ error: 'This fingerprint / Face ID sign-in was removed. Ask the owner to set it up again.' });
  const staff = passkey.staff_id ? db.prepare('SELECT id, name, role FROM staff WHERE id = ? AND active = 1').get(passkey.staff_id) : null;
  if (passkey.staff_id && !staff) return res.status(401).json({ error: 'This staff member was removed.' });
  if (!can(passkey.role, wanted)) {
    return res.status(403).json({ error: `${staff?.name ?? 'This person'} can't open the ${ROLE_LABEL[wanted] === 'Owner' ? 'admin panel' : ROLE_LABEL[wanted].toLowerCase() + ' screen'}.` });
  }

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: c.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: passkey.id, publicKey: new Uint8Array(passkey.public_key), counter: passkey.counter, transports: transportsOf(passkey) },
      requireUserVerification: true,
    });
  } catch (err) {
    return res.status(401).json({ error: `Sign-in failed: ${err.message}` });
  }
  if (!verification.verified) return res.status(401).json({ error: 'Sign-in failed' });

  db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
    .run(verification.authenticationInfo.newCounter, new Date().toISOString(), passkey.id);
  if (staff) logActivity({ role: staff.role, staff }, 'signed.in', `${staff.name} signed in`);
  startSession(req, res, passkey.role, staff?.id ?? 0);
  res.json({ home: storePath(req, `/${wanted}`), name: staff?.name ?? 'Owner' });
});
