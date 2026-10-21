import { builtInEvents } from '../../events.js';
import { storeContext, STORES } from '../core/config.js';
import { dayRange, isDate, localDate, money } from '../core/dates.js';
import { db } from '../core/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { dayReport, logActivity } from '../sales/orders.js';
import { app, storeBroadcast } from '../core/http.js';
import { menuItemProblem } from '../menu/routes.js';

// ---------- Admin: every day ----------

// One day's sales, receipts and activity log. Defaults to today.
app.get('/api/admin/day', (req, res) => {
  const date = req.query.date ?? localDate();
  if (!isDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const logs = db.prepare('SELECT * FROM activity_log WHERE business_date = ? ORDER BY id DESC').all(date);
  res.json({ ...dayReport(date), logs });
});

// The Ambiente owner sees both stores without merging their operational data.
app.get('/api/admin/stores', (req, res) => {
  if (req.store !== 'ambiente') return res.status(403).json({ error: 'Open the Ambiente owner dashboard' });
  const date = req.query.date ?? localDate();
  if (!isDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const stores = Object.entries(STORES).map(([id, store]) => ({
    id, name: store.name,
    summary: storeContext.run(id, () => dayReport(date).summary),
  }));
  res.json({ date, stores });
});

// Daily performance for the last N days (default 30), newest first. Quiet days are left out.
app.get('/api/admin/history', (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 366);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const byDate = new Map();
  for (let i = 0; i < days; i++) {
    const date = localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    byDate.set(date, { date, order_count: 0, gross_cents: 0, void_count: 0, void_cents: 0, edited_count: 0 });
  }
  const orders = db
    .prepare('SELECT created_at, status, total_cents, edit_count FROM orders WHERE created_at >= ?')
    .all(start.toISOString());
  for (const o of orders) {
    const row = byDate.get(localDate(new Date(o.created_at)));
    if (!row) continue;
    if (o.status === 'paid') {
      row.order_count++;
      row.gross_cents += o.total_cents;
    } else {
      row.void_count++;
      row.void_cents += o.total_cents;
    }
    if (o.edit_count > 0) row.edited_count++;
  }
  const today = localDate();
  res.json(
    [...byDate.values()].reverse().filter((r) => r.date === today || r.order_count || r.void_count)
  );
});

// The week (Monday to Sunday), month or year that contains `date`, plus the one before it.
export function periodRange(unit, date) {
  const [y, m, d] = date.split('-').map(Number);
  if (unit === 'week') {
    const monday = d - ((new Date(y, m - 1, d).getDay() + 6) % 7);
    return { start: new Date(y, m - 1, monday), end: new Date(y, m - 1, monday + 7), prevStart: new Date(y, m - 1, monday - 7) };
  }
  if (unit === 'month') return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), prevStart: new Date(y, m - 2, 1) };
  return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), prevStart: new Date(y - 1, 0, 1) };
}

export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const daysBetween = (a, b) => Math.round((b - a) / 86_400_000);

// ----- Seasonal events -----

export const hiddenEvents = () => new Set(JSON.parse(getSetting('hidden_events', '[]')));

// Built-in and owner-added events that touch the dates from..to (inclusive, YYYY-MM-DD).
export function eventsBetween(from, to, { includeHidden = false } = {}) {
  const hidden = hiddenEvents();
  const list = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const e of builtInEvents(y)) list.push({ ...e, hidden: hidden.has(e.key) });
  }
  for (const e of db.prepare('SELECT * FROM events WHERE active = 1 AND start_date <= ? AND end_date >= ?').all(to, from)) {
    list.push({ key: `custom:${e.name.toLowerCase()}`, name: e.name, kind: e.kind, start: e.start_date, end: e.end_date, note: e.note, custom_id: e.id, hidden: false });
  }
  return list.filter((e) => e.start <= to && e.end >= from && (includeHidden || !e.hidden));
}

export const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function datesOf(start, end) {
  const out = [];
  const [y, m, d] = start.split('-').map(Number);
  for (let i = 0; ; i++) {
    const date = localDate(new Date(y, m - 1, d + i));
    if (date > end) return out;
    out.push(date);
  }
}

// Paid sales per local day between two local dates. Grouped by UTC hour in SQL first, which
// keeps it quick over a couple of years of receipts.
export function dailySales(from, to) {
  const [startIso] = dayRange(from);
  const [, endIso] = dayRange(to);
  const byDay = new Map();
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 13) AS hour, SUM(total_cents) AS gross_cents, COUNT(*) AS order_count
         FROM orders WHERE status = 'paid' AND created_at >= ? AND created_at < ? GROUP BY hour`
    )
    .all(startIso, endIso);
  for (const r of rows) {
    const day = localDate(new Date(`${r.hour}:00:00Z`));
    const cur = byDay.get(day) ?? { gross_cents: 0, order_count: 0 };
    cur.gross_cents += r.gross_cents;
    cur.order_count += r.order_count;
    byDay.set(day, cur);
  }
  return byDay;
}

// How each event in the period sold: per day during the event, against the 28 normal days
// before it, and against the same event last year.
export function eventPerformance(periodStart, periodEnd) {
  const today = localDate();
  const events = eventsBetween(periodStart, periodEnd, { includeHidden: true });
  if (!events.length) return [];
  const firstSale = db.prepare("SELECT MIN(created_at) AS at FROM orders WHERE status = 'paid'").get().at;
  const opened = firstSale ? localDate(new Date(firstSale)) : null;

  const lastYearOf = (e) => {
    const y = Number(e.start.slice(0, 4)) - 1;
    if (e.custom_id) {
      return db.prepare('SELECT start_date AS start, end_date AS end FROM events WHERE active = 1 AND lower(name) = lower(?) AND start_date LIKE ?')
        .get(e.name, `${y}-%`) ?? null;
    }
    return builtInEvents(y).find((p) => p.key === e.key) ?? null;
  };
  const earliest = events.reduce((min, e) => {
    const ly = lastYearOf(e);
    const candidates = [e.start, ly?.start].filter(Boolean);
    return candidates.reduce((a, b) => (b < a ? b : a), min);
  }, periodStart);
  const from = localDate(addDays(parseDay(earliest), -90));
  const sales = dailySales(from, periodEnd > today ? today : periodEnd);
  // Days inside any event aren't "normal" days.
  const eventDays = new Set(eventsBetween(from, periodEnd).flatMap((e) => datesOf(e.start, e.end)));

  const measure = (start, end) => {
    const days = datesOf(start, end).filter((d) => d <= today && opened && d >= opened);
    if (!days.length) return null;
    const gross = days.reduce((n, d) => n + (sales.get(d)?.gross_cents ?? 0), 0);
    const orders = days.reduce((n, d) => n + (sales.get(d)?.order_count ?? 0), 0);
    return { start, end, days: days.length, gross_cents: gross, order_count: orders, per_day_cents: Math.round(gross / days.length) };
  };

  return events.map((e) => {
    const during = measure(e.start, e.end);
    let baseline = null;
    if (during) {
      // The 28 most recent normal days before it, looking back up to 90 days (a fiesta day
      // straight after a month-long festival still gets a fair comparison).
      const before = datesOf(localDate(addDays(parseDay(e.start), -90)), e.start)
        .filter((d) => d < e.start && !eventDays.has(d) && opened && d >= opened)
        .slice(-28);
      if (before.length >= 7) baseline = Math.round(before.reduce((n, d) => n + (sales.get(d)?.gross_cents ?? 0), 0) / before.length);
    }
    const ly = lastYearOf(e);
    const lastYear = ly ? measure(ly.start, ly.end) : null;
    return {
      ...e,
      status: e.start > today ? 'upcoming' : e.end >= today ? 'ongoing' : 'past',
      during,
      baseline_per_day_cents: baseline,
      lift_pct: during && baseline ? Math.round(((during.per_day_cents - baseline) / baseline) * 100) : null,
      last_year: lastYear,
    };
  });
}

// Sales for a week, month or year: one bar per day (or per month for a year), totals,
// a fair comparison with the period before, and what sold best.
app.get('/api/admin/period', (req, res) => {
  const unit = req.query.unit ?? 'month';
  if (!['week', 'month', 'year'].includes(unit)) return res.status(400).json({ error: 'unit must be week, month or year' });
  const date = req.query.date ?? localDate();
  if (!isDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  const { start, end, prevStart } = periodRange(unit, date);
  const today = localDate();
  const tomorrow = addDays(new Date(), 1);
  tomorrow.setHours(0, 0, 0, 0);
  const isCurrent = start < tomorrow && tomorrow <= end;
  // Days that have happened so far. A period still under way is compared with the same
  // number of days at the start of the previous one, not the whole of it.
  const totalDays = daysBetween(start, end);
  const elapsedDays = start >= tomorrow ? 0 : isCurrent ? daysBetween(start, tomorrow) : totalDays;
  const prevEnd = isCurrent ? new Date(Math.min(addDays(prevStart, elapsedDays), start)) : start;

  const buckets = new Map();
  if (unit === 'year') {
    for (let i = 0; i < 12; i++) {
      const key = `${start.getFullYear()}-${String(i + 1).padStart(2, '0')}`;
      buckets.set(key, { key, future: key > today.slice(0, 7) });
    }
  } else {
    for (let d = start; d < end; d = addDays(d, 1)) {
      const key = localDate(d);
      buckets.set(key, { key, future: key > today });
    }
  }
  for (const b of buckets.values()) Object.assign(b, { order_count: 0, gross_cents: 0, void_count: 0, void_cents: 0 });

  const summary = { order_count: 0, gross_cents: 0, void_count: 0, void_cents: 0, edited_count: 0, trading_days: 0 };
  const hours = Array.from({ length: 24 }, () => ({ order_count: 0, gross_cents: 0 }));
  const salesByDay = new Map();
  const receiptsByDay = new Map();
  const orders = db
    .prepare('SELECT created_at, status, total_cents, edit_count FROM orders WHERE created_at >= ? AND created_at < ?')
    .all(start.toISOString(), end.toISOString());
  for (const o of orders) {
    const at = new Date(o.created_at);
    const day = localDate(at);
    const bucket = buckets.get(unit === 'year' ? day.slice(0, 7) : day);
    if (o.status === 'paid') {
      bucket.order_count++;
      bucket.gross_cents += o.total_cents;
      summary.order_count++;
      summary.gross_cents += o.total_cents;
      hours[at.getHours()].order_count++;
      hours[at.getHours()].gross_cents += o.total_cents;
      salesByDay.set(day, (salesByDay.get(day) ?? 0) + o.total_cents);
      receiptsByDay.set(day, (receiptsByDay.get(day) ?? 0) + 1);
    } else {
      bucket.void_count++;
      bucket.void_cents += o.total_cents;
      summary.void_count++;
      summary.void_cents += o.total_cents;
    }
    if (o.edit_count > 0) summary.edited_count++;
  }
  summary.trading_days = salesByDay.size;

  // Average sales per weekday (0 = Sunday), over the days that have happened.
  const weekdays = Array.from({ length: 7 }, (_, weekday) => ({ weekday, days: 0, gross_cents: 0 }));
  for (let d = start, i = 0; i < elapsedDays; d = addDays(d, 1), i++) {
    weekdays[d.getDay()].days++;
    weekdays[d.getDay()].gross_cents += salesByDay.get(localDate(d)) ?? 0;
  }

  const previous = db
    .prepare(
      `SELECT COALESCE(SUM(status = 'paid'), 0)                                 AS order_count,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents END), 0) AS gross_cents
         FROM orders WHERE created_at >= ? AND created_at < ?`
    )
    .get(prevStart.toISOString(), prevEnd.toISOString());

  const range = [start.toISOString(), end.toISOString()];
  const topItems = db
    .prepare(
      `SELECT MAX(oi.name) AS name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price_cents) AS revenue_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status = 'paid'
        GROUP BY oi.menu_item_id
        ORDER BY revenue_cents DESC, qty DESC
        LIMIT 8`
    )
    .all(...range);
  const categories = db
    .prepare(
      `SELECT m.category, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price_cents) AS revenue_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN menu_items m ON m.id = oi.menu_item_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status = 'paid'
        GROUP BY m.category
        ORDER BY revenue_cents DESC`
    )
    .all(...range);

  res.json({
    unit,
    start: localDate(start),
    end: localDate(addDays(end, -1)),
    isCurrent,
    elapsedDays,
    totalDays,
    buckets: [...buckets.values()],
    summary,
    previous: { ...previous, start: localDate(prevStart), end: localDate(addDays(prevEnd, -1)), partial: isCurrent },
    hours,
    weekdays,
    topItems,
    categories,
    events: eventPerformance(localDate(start), localDate(addDays(end, -1))),
    // Every day of the period, for the full-year calendar (?daily=1).
    days: req.query.daily ? datesOf(localDate(start), localDate(addDays(end, -1))).map((key) => ({
      key, future: key > today, gross_cents: salesByDay.get(key) ?? 0, order_count: receiptsByDay.get(key) ?? 0,
    })) : undefined,
    payday: paydayStats(salesByDay, start, elapsedDays),
  });
});

// Filipinos are paid on the 15th and the last day of the month; spending jumps that day and the next.
export function paydayStats(salesByDay, start, elapsedDays) {
  const pay = { days: 0, gross_cents: 0 }, other = { days: 0, gross_cents: 0 };
  for (let i = 0; i < elapsedDays; i++) {
    const d = addDays(start, i);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const isPay = [15, 16, lastDay, 1].includes(d.getDate());
    const bucket = isPay ? pay : other;
    bucket.days++;
    bucket.gross_cents += salesByDay.get(localDate(d)) ?? 0;
  }
  return {
    payday_per_day_cents: pay.days ? Math.round(pay.gross_cents / pay.days) : null,
    other_per_day_cents: other.days ? Math.round(other.gross_cents / other.days) : null,
    payday_days: pay.days,
  };
}

// Owner: add an event of their own, or hide / show a built-in one.
app.post('/api/admin/events', (req, res) => {
  const { name, start, end, kind, note } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return res.status(400).json({ error: 'Name must be 1–60 characters' });
  if (!isDate(start) || !isDate(end) || end < start) return res.status(400).json({ error: 'Pick a start date and an end date on or after it' });
  if (!['iligan', 'national'].includes(kind)) return res.status(400).json({ error: 'Choose Iligan or Philippines' });
  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 140) : null;
  const id = Number(db.prepare('INSERT INTO events (name, start_date, end_date, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), start, end, kind, cleanNote, new Date().toISOString()).lastInsertRowid);
  logActivity(req, 'event.added', `Added event ${name.trim()} (${start}${end !== start ? ` to ${end}` : ''})`);
  res.status(201).json({ id });
});

app.delete('/api/admin/events/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!event) return res.status(404).json({ error: 'Event not found' });
  db.prepare('UPDATE events SET active = 0 WHERE id = ?').run(event.id);
  logActivity(req, 'event.removed', `Removed event ${event.name}`);
  res.json({ ok: true });
});

app.post('/api/admin/events/visibility', (req, res) => {
  const { key, hidden } = req.body ?? {};
  if (typeof key !== 'string' || key.startsWith('custom:') || typeof hidden !== 'boolean') return res.status(400).json({ error: 'Unknown event' });
  const set = hiddenEvents();
  if (hidden) set.add(key);
  else set.delete(key);
  setSetting('hidden_events', JSON.stringify([...set]));
  res.json({ hidden: [...set] });
});

// Admin: items waiting for approval.
app.get('/api/admin/menu-requests', (req, res) => {
  res.json(db.prepare("SELECT * FROM menu_items WHERE status = 'pending' ORDER BY id").all());
});

// Admin: approve (optionally fixing name, category or price first) or reject.
app.post('/api/admin/menu-requests/:id', (req, res) => {
  const item = db.prepare("SELECT * FROM menu_items WHERE id = ? AND status = 'pending'").get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'This request was already handled' });

  const { decision } = req.body ?? {};
  const now = new Date().toISOString();
  if (decision === 'reject') {
    db.prepare("UPDATE menu_items SET status = 'rejected', active = 0, reviewed_at = ? WHERE id = ?").run(now, item.id);
    logActivity(req, 'menu.rejected', `Rejected menu item ${item.name}`);
  } else if (decision === 'approve') {
    const edited = {
      name: req.body.name ?? item.name,
      category: req.body.category ?? item.category,
      priceCents: req.body.priceCents ?? item.price_cents,
    };
    const problem = menuItemProblem(edited, item.id);
    if (problem) return res.status(400).json({ error: problem });
    db.prepare(
      "UPDATE menu_items SET status = 'approved', name = ?, category = ?, price_cents = ?, reviewed_at = ? WHERE id = ?"
    ).run(edited.name.trim(), edited.category.trim(), edited.priceCents, now, item.id);
    logActivity(req, 'menu.approved',
      `Approved menu item ${edited.name.trim()} (${edited.category.trim()}) at ${money(edited.priceCents)}`);
  } else {
    return res.status(400).json({ error: 'decision must be approve or reject' });
  }

  storeBroadcast(['pos', 'barista', 'admin']).emit('menu.updated');
  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(item.id));
});
