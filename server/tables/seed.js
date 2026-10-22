import { currentStore } from '../core/config.js';
import { db } from '../core/db.js';
import { getSetting, setSetting } from '../core/settings.js';

// Café Ambiente's floor, from the owner's sketch. The owner can rename, add, remove and move tables.
export const AMBIENTE_TABLES = [
  ['Balcony 1', 4, 138, 160, 90, 50], ['Balcony 2', 4, 148, 310, 90, 50],
  ['Balcony 3', 4, 138, 460, 90, 50], ['Balcony 4', 4, 148, 610, 90, 50],
  ['Table 1', 4, 313, 175, 50, 90], ['Table 2', 2, 358, 103, 44, 44], ['Table 3', 2, 480, 106, 44, 44],
  ['Couch', 6, 715, 137, 136, 56], ['Table 4', 2, 953, 81, 44, 44], ['Table 5', 2, 958, 247, 44, 44],
  ['Table 6', 2, 964, 384, 44, 44], ['Table 7', 2, 964, 465, 44, 44],
  ['Table 8', 4, 1118, 95, 50, 90], ['Table 9', 4, 1128, 215, 50, 90], ['Table 10', 4, 1105, 355, 90, 50],
  ['Table 11', 4, 1095, 465, 90, 50], ['Table 12', 4, 1108, 585, 90, 50],
  ['Table 13', 4, 690, 565, 90, 50], ['Table 14', 4, 680, 440, 90, 50],
  ['Table 15', 4, 818, 560, 90, 50], ['Table 16', 4, 823, 430, 90, 50],
];
// The couch is an L around a wider table; COUCH is that table's size.
export const COUCH = { w: 136, h: 56, seats: 6 };
// Every table of a kind is drawn the same size: a 2-seater is a small square with the two chairs
// facing each other; anything bigger is a long table, lying the way it was drawn.
export const TWO_SEATER = 44, LONG_SIDE = 90, SHORT_SIDE = 50;
export function tableSize(seats, upright = false) {
  if (seats <= 2) return { w: TWO_SEATER, h: TWO_SEATER };
  return upright ? { w: SHORT_SIDE, h: LONG_SIDE } : { w: LONG_SIDE, h: SHORT_SIDE };
}
// Resizes a table about its centre, so it stays where it was on the map.
export function resized(t, seats = t.seats) {
  const { w, h } = tableSize(seats, t.h > t.w);
  return { w, h, x: Math.max(0, Math.round(t.x + (t.w - w) / 2)), y: Math.max(70, Math.round(t.y + (t.h - h) / 2)) };
}
export function seedTables() {
  if (currentStore() === 'ambiente' && getSetting('tables_seeded', '') !== '1') {
    const insert = db.prepare('INSERT INTO floor_tables (name, seats, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    for (const t of AMBIENTE_TABLES) insert.run(...t, now);
    setSetting('tables_seeded', '1');
  }
  if (getSetting('tables_uniform', '') !== '1') {
    const update = db.prepare('UPDATE floor_tables SET x = ?, y = ?, w = ?, h = ? WHERE id = ?');
    for (const t of db.prepare('SELECT * FROM floor_tables').all()) {
      const { x, y, w, h } = resized(t);
      update.run(x, y, w, h, t.id);
    }
    setSetting('tables_uniform', '1');
  }
  // Floors seeded before the balcony grew to four tables get the two new ones, unless the owner
  // already has tables by those names.
  if (currentStore() === 'ambiente' && getSetting('tables_balcony_4', '') !== '1') {
    const insert = db.prepare('INSERT INTO floor_tables (name, seats, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    for (const t of AMBIENTE_TABLES.filter(([name]) => /^Balcony [34]$/.test(name))) {
      if (!db.prepare('SELECT 1 FROM floor_tables WHERE lower(name) = lower(?) AND active = 1').get(t[0])) insert.run(...t, now);
    }
    setSetting('tables_balcony_4', '1');
  }
  // The couch became an L seating six: a couch still at its first size grows about its centre.
  if (currentStore() === 'ambiente' && getSetting('tables_couch_l', '') !== '1') {
    for (const t of db.prepare("SELECT * FROM floor_tables WHERE lower(name) = 'couch' AND active = 1 AND seats < ? AND w = 90 AND h = 50").all(COUCH.seats)) {
      db.prepare('UPDATE floor_tables SET seats = ?, x = ?, y = ?, w = ?, h = ? WHERE id = ?')
        .run(COUCH.seats, Math.round(t.x + (t.w - COUCH.w) / 2), Math.round(t.y + (t.h - COUCH.h) / 2), COUCH.w, COUCH.h, t.id);
    }
    setSetting('tables_couch_l', '1');
  }
}
