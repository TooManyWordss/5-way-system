import crypto from 'node:crypto';
import { currentStore } from '../core/config.js';
import { safeEqual } from './sessions.js';
import { getSetting } from '../core/settings.js';

// Environment codes bootstrap each screen; owner changes are stored per store.
// BARISTA_PIN and INVENTORY_PIN are optional: without one, that screen opens with Face ID / fingerprint or the owner's login.
export const SECRETS = {
  pos: process.env.POS_PIN,
  barista: process.env.BARISTA_PIN,
  inventory: process.env.INVENTORY_PIN,
  kitchen: process.env.KITCHEN_PIN,
  admin: process.env.ADMIN_PASSWORD,
};
export const environmentSecretFor = (role) => currentStore() === 'rairock'
  ? process.env[`RAIROCK_${role.toUpperCase()}_${role === 'admin' ? 'PASSWORD' : 'PIN'}`] || SECRETS[role]
  : SECRETS[role];
// Screen PINs and the owner's password can be changed from the dashboard; the saved hash then replaces the environment value.
export const pinHashFor = (role) => getSetting(`pin_${role}_hash`, null);
export function hashSecret(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(value, salt, 64).toString('hex')}`;
}
export const secretFor = (role) => pinHashFor(role) || environmentSecretFor(role);
export function matchesSecret(role, value) {
  if (typeof value !== 'string') return false;
  const hash = pinHashFor(role);
  if (!hash) return !!environmentSecretFor(role) && safeEqual(value, environmentSecretFor(role));
  const [scheme, salt, expected] = hash.split(':');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(value, salt, 64).toString('hex');
  return safeEqual(actual, expected);
}
export const SESSION_SECRET = process.env.SESSION_SECRET;
export const missing = ['POS_PIN', 'KITCHEN_PIN', 'ADMIN_PASSWORD', 'SESSION_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}
