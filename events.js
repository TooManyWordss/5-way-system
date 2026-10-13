// Seasonal events for the performance calendar: Iligan City first, then Philippine
// holidays and occasions that change how people spend. Dates follow the usual pattern;
// ones set each year by proclamation or the moon are marked `approx`, and the owner
// can hide any built-in event and add the exact dates as their own.

// kind: 'iligan' = local to Iligan City; 'national' = Philippine holidays and occasions.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => {
  const date = new Date(y, m - 1, d);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Easter Sunday (Gregorian calendar).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [month, ((h + l - 7 * m + 114) % 31) + 1];
}

// nth weekday of a month (weekday 0 = Sunday), e.g. the 2nd Sunday of May.
function nthWeekday(y, month, weekday, n) {
  const first = new Date(y, month - 1, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y, month, weekday) {
  const last = new Date(y, month, 0);
  return last.getDate() - ((last.getDay() - weekday + 7) % 7);
}

// Moon-based dates. Philippine holiday dates are confirmed by proclamation, usually close to these.
const LUNAR = {
  chineseNewYear: { 2024: [2, 10], 2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26] },
  ramadan: { 2024: [[3, 11], [4, 9]], 2025: [[3, 1], [3, 30]], 2026: [[2, 18], [3, 19]], 2027: [[2, 8], [3, 9]], 2028: [[1, 28], [2, 26]] },
  eidFitr: { 2024: [4, 10], 2025: [4, 1], 2026: [3, 20], 2027: [3, 10], 2028: [2, 27] },
  eidAdha: { 2024: [6, 17], 2025: [6, 6], 2026: [5, 27], 2027: [5, 16], 2028: [5, 5] },
};

export function builtInEvents(y) {
  const day = (key, name, kind, m, d, extra = {}) => ({ key, name, kind, start: iso(y, m, d), end: iso(y, m, d), ...extra });
  const span = (key, name, kind, [m1, d1], [m2, d2], extra = {}) => ({ key, name, kind, start: iso(y, m1, d1), end: iso(y, m2, d2), ...extra });
  const [em, ed] = easter(y);
  const events = [
    // ----- Iligan City -----
    day('iligan-charter', 'Iligan City Charter Day', 'iligan', 6, 16, { note: 'Special non-working day in Iligan (city since 1950)' }),
    span('diyandi', 'Diyandi Festival season', 'iligan', [9, 1], [9, 28], {
      note: 'Fiesta month for St. Michael: Diyandi dances, novena, street parties and visitors',
    }),
    day('san-miguel', 'Fiesta Señor San Miguel (Iligan City Fiesta)', 'iligan', 9, 29, { note: 'Special non-working day in Iligan; the fiesta peak' }),

    // ----- Philippines -----
    day('new-year', "New Year's Day", 'national', 1, 1),
    day('valentines', "Valentine's Day", 'national', 2, 14, { note: 'Couples and dates: drinks and desserts' }),
    day('edsa', 'EDSA Revolution Anniversary', 'national', 2, 25),
    span('holy-week', 'Holy Week (Maundy Thursday to Easter)', 'national', [em, ed - 3], [em, ed], {
      note: 'Many people go home to the province; Good Friday is very quiet',
    }),
    day('araw-ng-kagitingan', 'Araw ng Kagitingan', 'national', 4, 9),
    day('labor-day', 'Labor Day', 'national', 5, 1),
    day('mothers-day', "Mother's Day", 'national', 5, nthWeekday(y, 5, 0, 2), { note: 'Family meals out' }),
    day('independence', 'Independence Day', 'national', 6, 12),
    day('fathers-day', "Father's Day", 'national', 6, nthWeekday(y, 6, 0, 3), { note: 'Family meals out' }),
    day('ninoy', 'Ninoy Aquino Day', 'national', 8, 21),
    day('heroes', 'National Heroes Day', 'national', 8, lastWeekday(y, 8, 1)),
    day('halloween', 'Halloween', 'national', 10, 31),
    span('undas', 'Undas (All Saints & All Souls)', 'national', [11, 1], [11, 2], { note: 'Families at the cemetery; long weekend' }),
    day('bonifacio', 'Bonifacio Day', 'national', 11, 30),
    day('immaculate', 'Feast of the Immaculate Conception', 'national', 12, 8),
    span('simbang-gabi', 'Simbang Gabi', 'national', [12, 16], [12, 24], { note: 'Dawn masses: early-morning coffee and breakfast crowds' }),
    span('christmas', 'Christmas Eve & Christmas Day', 'national', [12, 24], [12, 25]),
    day('rizal', 'Rizal Day', 'national', 12, 30),
    day('new-years-eve', "New Year's Eve", 'national', 12, 31),
  ];

  const lunar = { approx: true, note: 'Date follows the moon; check the year’s proclamation' };
  if (LUNAR.chineseNewYear[y]) events.push(day('chinese-new-year', 'Chinese New Year', 'national', ...LUNAR.chineseNewYear[y], lunar));
  if (LUNAR.ramadan[y]) {
    events.push(span('ramadan', 'Ramadan', 'national', ...LUNAR.ramadan[y], {
      ...lunar, note: 'Daytime fasting for Muslim customers (large Maranao community around Iligan); evenings pick up',
    }));
  }
  if (LUNAR.eidFitr[y]) events.push(day('eid-fitr', "Eid'l Fitr", 'national', ...LUNAR.eidFitr[y], { ...lunar, note: 'End of Ramadan; national holiday' }));
  if (LUNAR.eidAdha[y]) events.push(day('eid-adha', "Eid'l Adha", 'national', ...LUNAR.eidAdha[y], { ...lunar, note: 'Feast of Sacrifice; national holiday' }));
  return events;
}
