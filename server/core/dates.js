
// ---------- Money and dates ----------

export const CURRENCY = process.env.CURRENCY || 'PHP';
export const moneyFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: CURRENCY });
export const money = (cents) => moneyFormat.format(cents / 100);

// Calendar date in the restaurant's time zone (set TZ), as YYYY-MM-DD.
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Start and end of a local day, as UTC ISO strings for querying created_at.
export function dayRange(date = localDate()) {
  const [y, m, d] = date.split('-').map(Number);
  return [new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString()];
}
