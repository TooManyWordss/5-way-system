export const minutesSince = (date?: string | null) => date ? Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000)) : 0;
export const tagName = (tag?: string | null) => tag === 'vip' ? 'VIP' : tag === 'repeat' ? 'Repeat customer' : '';
// Short enough to fit on the drawn table: "Table 12" → "12", "Balcony 1" → "B1".
export const tableLabel = (name: string) => { const short = name.replace(/^Table\s+/i, '').replace(/^Balcony\s*/i, 'B'); return short.length > 6 ? short.slice(0, 5) + '…' : short; };
// Chairs around a table: a 2-seater's two chairs face each other across it; bigger tables
// have their chairs split along the two long sides.
export const CHAIR = 16, CHAIR_GAP = 5;
export const isCouch = (name: string) => /couch/i.test(name);
// The couch has no chairs; couchFor draws its seats.
export function chairsFor(t: { name: string; seats: number; w: number; h: number }, x: number, y: number) {
  if (isCouch(t.name)) return [];
  const wide = t.w >= t.h, seats = Math.min(t.seats, 12), sides = [Math.ceil(seats / 2), Math.floor(seats / 2)];
  const out: { x: number; y: number }[] = [];
  sides.forEach((count, side) => { for (let i = 0; i < count; i++) {
    const along = (i + 1) / (count + 1);
    if (t.seats <= 2 || !wide) out.push({ x: side ? x + t.w + CHAIR_GAP : x - CHAIR_GAP - CHAIR, y: y + t.h * along - CHAIR / 2 });
    else out.push({ x: x + t.w * along - CHAIR / 2, y: side ? y + t.h + CHAIR_GAP : y - CHAIR_GAP - CHAIR });
  } });
  return out;
}
// The L-shaped couch wraps the table's top and right side, one cushion per seat:
// about a third of them on the short arm, the rest along the top.
export const COUCH_DEPTH = 22, COUCH_GAP = 6;
export function couchFor(t: { seats: number; w: number; h: number }, x: number, y: number) {
  const seats = Math.max(2, Math.min(t.seats, 16)), side = Math.max(1, Math.round(seats / 3)), top = seats - side;
  const left = x - 4, upper = y - COUCH_GAP - COUCH_DEPTH, right = x + t.w + COUCH_GAP, lower = y + t.h + 4;
  const frame = [{ x: left, y: upper, w: right + COUCH_DEPTH - left, h: COUCH_DEPTH }, { x: right, y: upper, w: COUCH_DEPTH, h: lower - upper }];
  const cushions: { x: number; y: number; w: number; h: number }[] = [];
  const along = (right - left) / top, down = (lower - y + COUCH_GAP) / side;
  for (let i = 0; i < top; i++) cushions.push({ x: left + i * along + 2, y: upper + 3, w: along - 4, h: COUCH_DEPTH - 6 });
  for (let i = 0; i < side; i++) cushions.push({ x: right + 3, y: y - COUCH_GAP + i * down + 2, w: COUCH_DEPTH - 6, h: down - 4 });
  return { frame, cushions };
}
