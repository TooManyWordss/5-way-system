import { useEffect, useState } from 'react';
import { diningRequest } from './dining-store';
import './kpi-dashboard.css';
import { CafeBusinessOverview } from './owner-overview';

type Average = { count: number; average_minutes: number | null };
type Metrics = { visits: number; paid_visits: number; guests_served: number; net_sales_cents: number; average_spend_cents: number | null } & Record<string, any>;
type Report = Metrics & { daily: (Metrics & { date: string })[]; previous: Metrics; previousFrom: string; previousTo: string };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const money = (cents: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
const timings = [['preparation', 'Kitchen preparation'], ['arrival_to_order', 'Arrival to first order'], ['eating', 'Eating duration'], ['bill_to_payment', 'Bill request to payment'], ['occupancy', 'Table occupancy']];
function change(now: number | null, before: number | null) {
  if (now == null || before == null || before === 0) return 'No prior baseline';
  const pct = (now - before) / before * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs prior period`;
}

export function KpiDashboard() {
  const [range, setRange] = useState({ from: shift(today(), -6), to: today() });
  const [draft, setDraft] = useState(range), [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true, sequence = 0;
    const load = async () => {
      const request = ++sequence; setLoading(true); setError('');
      try { const value = await diningRequest(`/metrics?from=${range.from}&to=${range.to}`); if (active && request === sequence) setReport({ ...value, daily: Array.isArray(value.daily) ? value.daily : [], previous: value.previous ?? {} }); }
      catch (e) { if (active && request === sequence) { setError((e as Error).message); setReport(null); } }
      finally { if (active && request === sequence) setLoading(false); }
    };
    void load(); window.addEventListener('dining.live', load);
    return () => { active = false; window.removeEventListener('dining.live', load); };
  }, [range.from, range.to, refresh]);
  const preset = (days: number) => { const next = { from: shift(today(), 1 - days), to: today() }; setDraft(next); setRange(next); };
  return <section className="panel kpi-dashboard" aria-labelledby="kpi-title" aria-busy={loading}>
    <header className="kpi-heading"><div><span className="kpi-eyebrow">Café Ambiente · owner's overview</span><h1 id="kpi-title">KPI dashboard</h1><p>Know what sells. Keep service moving. Make every table count.</p></div><button className="btn" onClick={() => setRefresh(n => n + 1)}>Refresh dashboard</button></header>
    <CafeBusinessOverview refresh={refresh}/>
    <h2 className="kpi-service-heading">Table service performance</h2>
    <form className="kpi-controls" onSubmit={e => { e.preventDefault(); setRange({ ...draft }); }}>
      <div className="dining-actions">{[[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days']].map(([days, label]) => <button className="btn small" type="button" key={days} onClick={() => preset(Number(days))}>{label}</button>)}</div>
      <label>From<input type="date" required value={draft.from} max={draft.to} onChange={e => setDraft({ ...draft, from: e.target.value })}/></label><label>Through<input type="date" required value={draft.to} min={draft.from} max={today()} onChange={e => setDraft({ ...draft, to: e.target.value })}/></label><button className="btn primary">Apply dates</button>
    </form>
    {loading && <p role="status">Updating dashboard…</p>}{error && <p role="alert">{error} Reconnect and refresh to retry.</p>}
    {!loading && report && <>
      <p className="kpi-period">{range.from} — {range.to}{report.previousFrom ? ` · compared with ${report.previousFrom} — ${report.previousTo}` : ' · Comparison and daily trends unavailable. Restart the backend to enable the updated report.'}</p>
      <div className="kpi-cards">{[['net_sales_cents', 'Net sales', money(report.net_sales_cents)], ['guests_served', 'Guests served', report.guests_served], ['average_spend_cents', 'Spend per guest', report.average_spend_cents == null ? '—' : money(report.average_spend_cents)], ['paid_visits', 'Paid visits', report.paid_visits]].map(([key, label, value]) => <article className="kpi-card" key={key}><span>{label}</span><strong>{value}</strong><small>{change(report[key], report.previous[key])}</small></article>)}</div>
      {!report.visits && <p className="empty">No table visits in this period. Seat a party and record service events to populate this dashboard.</p>}
      <div className="kpi-charts"><Trend title="Daily net sales" rows={report.daily} field="net_sales_cents" format={money}/><Trend title="Daily guests served" rows={report.daily} field="guests_served" format={String}/></div>
      <h2>Service times</h2><div className="kpi-times">{timings.map(([key, label]) => { const value: Average = report[key] ?? { count: 0, average_minutes: null }; const before: Average = report.previous[key] ?? { count: 0, average_minutes: null }; return <article className="kpi-card" key={key}><span>{label}</span><strong>{value.average_minutes == null ? '—' : `${value.average_minutes.toFixed(1)} min`}</strong><small>{value.count} complete samples</small><small>{change(value.average_minutes, before.average_minutes)}</small></article>; })}</div>
      <details><summary>Daily figures and calculation notes</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th>Net sales</th><th>Guests served</th><th>Paid visits</th></tr></thead><tbody>{report.daily.map(row => <tr key={row.date}><td>{row.date}</td><td>{money(row.net_sales_cents)}</td><td>{row.guests_served}</td><td>{row.paid_visits}</td></tr>)}</tbody></table></div><p>Visits are grouped by arrival date in Asia/Manila. Sales and guest totals use settled visits; net sales exclude discounts and tax. Cancelled and refunded visits are excluded. Duration averages include only complete timestamp pairs. Counter and Barista sales remain in the sales reports below. Offline activity appears after synchronization.</p></details>
    </>}
  </section>;
}
function Trend({ title, rows, field, format }: { title: string; rows: Report['daily']; field: string; format: (value: number) => string }) {
  if (!rows.length) return <figure className="kpi-trend"><figcaption>{title}</figcaption><p>Daily figures unavailable from this server.</p></figure>;
  const max = Math.max(1, ...rows.map(row => row[field]));
  return <figure className="kpi-trend"><figcaption>{title}</figcaption><small>Peak: {format(Math.max(0, ...rows.map(row => row[field])))}</small><svg viewBox="0 0 600 160" role="img" aria-label={`${title} from ${rows[0]?.date} through ${rows.at(-1)?.date}. Exact values in daily figures below.`} preserveAspectRatio="none"><line x1="0" y1="150" x2="600" y2="150" stroke="currentColor" opacity=".2"/>{rows.map((row, i) => <rect key={row.date} x={i * 600 / rows.length + 1} y={150 - row[field] / max * 140} width={Math.max(0.5, 600 / rows.length - 2)} height={row[field] / max * 140} rx="2"><title>{row.date}: {format(row[field])}</title></rect>)}</svg><div className="kpi-axis"><small>{rows[0]?.date}</small><small>{rows.at(-1)?.date}</small></div></figure>;
}
