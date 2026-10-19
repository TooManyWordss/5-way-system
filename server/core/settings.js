import { db } from './db.js';

export const getSetting = (key, fallback) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
// The owner's password always works, so the owner can never be locked out.
export const pinAllowed = (role) => role === 'admin' || getSetting(`pin_${role}`, '1') === '1';
