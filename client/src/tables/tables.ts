export const minutesSince = (date?: string | null) => date ? Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000)) : 0;
export const tagName = (tag?: string | null) => tag === 'vip' ? 'VIP' : tag === 'repeat' ? 'Repeat customer' : '';
// Short enough to fit on the drawn table: "Table 12" → "12", "Balcony 1" → "B1".
export const tableLabel = (name: string) => { const short = name.replace(/^Table\s+/i, '').replace(/^Balcony\s*/i, 'B'); return short.length > 6 ? short.slice(0, 5) + '…' : short; };
// Chairs around a table: a 2-seater's two chairs face each other across it; bigger tables
// have their chairs split along the two long sides.
export const CHAIR = 16, CHAIR_GAP = 5;
// The couch is the seating on one side, so its chairs all go on the open side.
export function chairsFor(t: { name: string; seats: number; w: number; h: number }, x: number, y: number) {
  const wide = t.w >= t.h, seats = Math.min(t.seats, 12), sides = /couch/i.test(t.name) ? [0, seats] : [Math.ceil(seats / 2), Math.floor(seats / 2)];
  const out: { x: number; y: number }[] = [];
  sides.forEach((count, side) => { for (let i = 0; i < count; i++) {
    const along = (i + 1) / (count + 1);
    if (t.seats <= 2 || !wide) out.push({ x: side ? x + t.w + CHAIR_GAP : x - CHAIR_GAP - CHAIR, y: y + t.h * along - CHAIR / 2 });
    else out.push({ x: x + t.w * along - CHAIR / 2, y: side ? y + t.h + CHAIR_GAP : y - CHAIR_GAP - CHAIR });
  } });
  return out;
}
