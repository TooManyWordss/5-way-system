import { currentStore } from '../core/config.js';
import { db } from '../core/db.js';
import { getSetting, setSetting } from '../core/settings.js';

// Café Ambiente's floor, from the owner's sketch, on one grid: five rows 120 apart (centres at
// y 165, 285, 405, 525, 645) and fixed column centres (balcony 183, Tables 2/1 338, Table 3 502,
// the 13–16 block 735 and 860 with the couch centred above it, Tables 4–7 982, Tables 8–12 1150). The owner can rename, add,
// remove and move tables.
export const AMBIENTE_TABLES = [
  ['Balcony 1', 4, 138, 140, 90, 50], ['Balcony 2', 4, 138, 260, 90, 50],
  ['Balcony 3', 4, 138, 380, 90, 50], ['Balcony 4', 4, 138, 500, 90, 50],
  ['Table 1', 4, 313, 240, 50, 90], ['Table 2', 2, 316, 143, 44, 44], ['Table 3', 2, 480, 143, 44, 44],
  ['Couch', 6, 730, 137, 136, 56], ['Table 4', 2, 960, 143, 44, 44], ['Table 5', 2, 960, 263, 44, 44],
  ['Table 6', 2, 960, 383, 44, 44], ['Table 7', 2, 960, 503, 44, 44],
  ['Table 8', 4, 1125, 120, 50, 90], ['Table 9', 4, 1125, 240, 50, 90], ['Table 10', 4, 1105, 380, 90, 50],
  ['Table 11', 4, 1105, 500, 90, 50], ['Table 12', 4, 1105, 620, 90, 50],
  ['Table 13', 4, 690, 620, 90, 50], ['Table 14', 4, 690, 500, 90, 50],
  ['Table 15', 4, 815, 620, 90, 50], ['Table 16', 4, 815, 500, 90, 50],
];
// Where each table sat in earlier versions of the plan. A table still at one of these spots moves onto
// the grid; a table the owner has moved anywhere else stays put.
const EARLIER_SPOTS = {
  'Balcony 1': [[138, 160]], 'Balcony 2': [[148, 310], [138, 310]], 'Balcony 3': [[138, 460]], 'Balcony 4': [[148, 610], [138, 610]],
  'Table 1': [[313, 175]], 'Table 2': [[358, 103], [316, 103]], 'Table 3': [[480, 106], [480, 103]], 'Couch': [[715, 137]],
  'Table 4': [[953, 81], [960, 103]], 'Table 5': [[958, 247], [960, 223]], 'Table 6': [[964, 384], [960, 343]], 'Table 7': [[964, 465], [960, 463]],
  'Table 8': [[1118, 95], [1125, 95]], 'Table 9': [[1128, 215], [1125, 215]], 'Table 10': [[1105, 355], [1105, 350]],
  'Table 11': [[1095, 465], [1105, 465]], 'Table 12': [[1108, 585], [1105, 580]],
  'Table 13': [[690, 565]], 'Table 14': [[680, 440], [690, 435]], 'Table 15': [[818, 560], [825, 565]], 'Table 16': [[823, 430], [825, 435]],
};
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
  // Put the tables on the grid once; any table the owner has moved stays where they put it.
  if (currentStore() === 'ambiente' && getSetting('tables_grid', '') !== '1') {
    const move = db.prepare('UPDATE floor_tables SET x = ?, y = ? WHERE active = 1 AND name = ? AND x = ? AND y = ?');
    for (const [name, , x, y] of AMBIENTE_TABLES) for (const spot of EARLIER_SPOTS[name] ?? []) move.run(x, y, name, ...spot);
    setSetting('tables_grid', '1');
  }
}
