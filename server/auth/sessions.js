import crypto from 'node:crypto';
import { currentStore, STORES } from '../core/config.js';
import { SECRETS, SESSION_SECRET } from './secrets.js';
import { db } from '../core/db.js';

// ---------- Logins ----------

// How long each device stays logged in. Tablets stay in for a month;
// the owner's login is shorter because it's on a personal phone or laptop.
export const SESSION_DAYS = { pos: 30, barista: 30, kitchen: 30, inventory: 30, admin: 7 };

export const isRole = (role) => typeof role === 'string' && Object.hasOwn(SECRETS, role);
export const can = (role, ...needs) => role === 'admin' || needs.includes(role);

// The two tills. Each keeps its own receipts, numbering and "today" view.
export const STATION_OF_ROLE = { pos: 'cashier', barista: 'barista' };
export const SELLERS = ['pos', 'barista'];
// The cashier or barista always sells from their own till; the owner says which screen they're on.
export const stationOf = (req, asked) => STATION_OF_ROLE[req.role] ?? (asked === 'barista' ? 'barista' : 'cashier');
export const receiptLabel = (o) => (o.station === 'barista' ? `B-${String(o.receipt_no).padStart(4, '0')}` : String(o.receipt_no));

export function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

export function safeEqual(a, b) {
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Staff who sign in with their own passkey get a shift-length session, so the next
// cashier has to sign in as themselves.
export const STAFF_SESSION_HOURS = 16;

// Session cookie format: "<role>.<expiry ms>.<staff id, 0 for a shared PIN or the owner>.<signature>"
export function makeSession(role, staffId = 0) {
  const ms = staffId ? STAFF_SESSION_HOURS * 3_600_000 : SESSION_DAYS[role] * 86_400_000;
  const value = `${role}.${currentStore()}.${Date.now() + ms}.${staffId}`;
  return { token: `${value}.${sign(value)}`, maxAgeSeconds: Math.round(ms / 1000) };
}

// Returns { role, staff } or null. Staff sessions end as soon as the owner removes that person.
export function readSession(cookieHeader = '') {
  const cookieName = currentStore() === 'rairock' ? 'session_rairock' : 'session';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const parts = cookie.slice(`${cookieName}=`.length).split('.');
  if (parts.length < 3 || parts.length > 5) return null;
  const [role, second] = parts;
  const modern = Object.hasOwn(STORES, second);
  const store = modern ? second : 'ambiente';
  const expires = modern ? parts[2] : second;
  const signature = parts.at(-1);
  if (!isRole(role) || !signature || !safeEqual(signature, sign(parts.slice(0, -1).join('.')))) return null;
  if (store !== currentStore()) return null;
  if (!(Number(expires) > Date.now())) return null;
  const staffId = modern ? Number(parts[3]) : parts.length === 4 ? Number(parts[2]) : 0;
  if (!staffId) return { role, staff: null };
  const staff = db.prepare('SELECT id, name, role FROM staff WHERE id = ? AND active = 1').get(staffId);
  return staff ? { role, staff } : null;
}

export function sessionCookie(req, value, maxAgeSeconds) {
  const cookieName = req.store === 'rairock' ? 'session_rairock' : 'session';
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${req.secure ? '; Secure' : ''}`;
}

export function startSession(req, res, role, staffId = 0) {
  const { token, maxAgeSeconds } = makeSession(role, staffId);
  res.setHeader('Set-Cookie', sessionCookie(req, token, maxAgeSeconds));
}

export function requireRole(...needs) {
  return (req, res, next) => {
    const session = readSession(req.headers.cookie);
    if (session && can(session.role, ...needs)) {
      req.role = session.role;
      req.staff = session.staff;
      return next();
    }
    res.status(401).json({ error: 'Please log in' });
  };
}

// Slow down PIN guessing: 5 wrong tries for one screen from one address locks it for 5 minutes.
// Counted per screen, so logging in to the POS doesn't reset failed admin attempts.
export const loginFailures = new Map(); // "ip|role" -> { count, lockedUntil }
