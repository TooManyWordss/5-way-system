import { useEffect, useState } from 'react';
import { ticketState, totals } from '../../dining-domain.js';

const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value / 100);
async function read(url: string) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${url.includes('inventory') ? 'inventory' : url.includes('dining') ? 'table activity' : 'sales'}`);
  return response.json();
}
export function CafeBusinessOverview({ refresh }: { refresh: number }) {
  const [data, setData] = useState<any>({}), [errors, setErrors] = useState<string[]>([]), [at, setAt] = useState('');
  useEffect(() => {
    let active = true, sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const values = await Promise.allSettled(['/api/admin/day', '/api/dining/state', '/api/admin/inventory', '/api/tables'].map(read));
      if (!active || request !== sequence) return;
      const result: any = {}, failures: string[] = [];
      values.forEach((value, i) => { if (value.status === 'fulfilled') result[['sales', 'dining', 'stock', 'floor'][i]] = value.value; else failures.push(value.reason.message); });
      setData(result); setErrors(failures); setAt(new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }));
    };
    void load(); const interval = window.setInterval(load, 60000);
    window.addEventListener('dining.live', load); window.addEventListener('dining.business', load);
    return () => { active = false; clearInterval(interval); window.removeEventListener('dining.live', load); window.removeEventListener('dining.business', load); };
  }, [refresh]);
  const { sales, dining, stock, floor } = data;
  const visits: any[] = Object.values(dining?.visits ?? {});
  const active = visits.filter(v => !v.released_at && !['cancelled', 'refunded'].includes(v.status));
  const unpaid = active.filter(v => v.status === 'open');
  const tables: any[] = [...Object.values(dining?.tables ?? {}).filter((t: any) => t.active), ...(floor ?? []).map((t: any) => ({...t,visit_id: t.party ? 'occupied' : null}))];
  const occupied = tables.filter(t => t.visit_id).length, percent = tables.length ? Math.round(occupied / tables.length * 100) : 0;
  const orders: any[] = sales?.orders?.filter((o: any) => o.status === 'paid') ?? [];
  const net = orders.reduce((sum, o) => sum + o.subtotal_cents - (o.discount_cents ?? 0), 0);
  const hours = Array.from({ length: 24 }, (_, hour) => orders.filter(o => new Date(Date.parse(o.created_at) + 8 * 3600000).getUTCHours() === hour).reduce((n, o) => n + o.total_cents, 0));
  const max = Math.max(1, ...hours), low = stock?.items?.filter((i: any) => i.low) ?? [];
  const queue = active.flatMap(v => v.submissions.map((s: any) => ({ ...s, table: v.table_name, state: ticketState(s) }))).filter(s => s.state !== 'ready' && !s.cancelled_at && s.lines.some((l: any) => l.sends_to_kitchen && l.qty > 0));
  const sorted = [...unpaid].sort((a, b) => (a.bill_requested_at ?? a.arrived_at).localeCompare(b.bill_requested_at ?? b.arrived_at));
  return <div className="cafe-overview">
    <div className="overview-caption"><h2>Trading today <small>{sales?.date ?? ''} · Asia/Manila</small></h2><span>{at ? `Updated ${at}` : 'Loading business activity…'}</span></div>
    {errors.length > 0 && <p role="alert">{errors.join('. ')}. Use Refresh dashboard to retry.</p>}
    <div className="business-cards">
      <article><span>Net sales today</span><strong>{sales ? money(net) : '—'}</strong><small>After discounts · excludes tax</small></article>
      <article><span>Paid receipts</span><strong>{sales ? orders.length : '—'}</strong><small>Tables + counter + Barista</small></article>
      <article><span>Average receipt</span><strong>{orders.length ? money(sales.summary.gross_cents / orders.length) : '—'}</strong><small>Customer bill · includes tax</small></article>
      <article><span>Unpaid table bills · live</span><strong>{dining ? money(unpaid.reduce((sum, v) => sum + totals(v, dining.taxRate).total_cents, 0)) : '—'}</strong><small>{unpaid.length} open visits · not collected sales</small></article>
    </div>
    <div className="business-top-grid">
      <section className="business-panel hourly-panel"><h3>Sales by hour</h3><p>Paid bills today · includes tax · peak {money(Math.max(0, ...hours))}</p><div className="hour-chart" role="img" aria-label="Hourly sales in Manila time. Exact values in the hourly figures below.">{hours.map((value, hour) => <div key={hour} title={`${String(hour).padStart(2, '0')}:00 — ${money(value)}`}><i style={{ height: `${value / max * 100}%` }}/>{hour % 4 === 0 && <small>{String(hour).padStart(2, '0')}:00</small>}</div>)}</div><details><summary>Hourly figures</summary>{hours.map((value, hour) => <div className="business-row" key={hour}><span>{hour}:00</span><b>{money(value)}</b></div>)}</details></section>
      <section className="business-panel"><h3>Kitchen workload · live</h3><p>Table tickets in progress</p>{[['Waiting', queue.filter(s => s.state === 'new').length], ['Preparing', queue.filter(s => s.state === 'preparing').length]].map(([label, value]) => <div className="workload" key={label}><div><span>{label}</span><strong>{value}</strong></div><progress value={Number(value)} max={Math.max(1, queue.length)}/></div>)}<a href="/kitchen">Open kitchen →</a></section>
      <section className="business-panel"><h3>Tables to follow up · live</h3><p>Bill requests first, then earliest arrival</p>{[...sorted].sort((a,b)=>Number(!!b.bill_requested_at)-Number(!!a.bill_requested_at)).slice(0,5).map(v => <div className="business-row" key={v.id}><span>{v.table_name}<small>{v.bill_requested_at ? 'Bill requested' : 'Open tab'} · {Math.max(0, Math.floor((Date.now()-Date.parse(v.arrived_at))/60000))} min seated</small></span><b>{money(totals(v, dining.taxRate).total_cents)}</b></div>)}{!unpaid.length && <p>No unpaid table visits.</p>}<a href="#tables">Review table service →</a></section>
    </div>
    <div className="business-bottom-grid">
      <section className="business-panel occupancy-panel"><h3>Table occupancy · live</h3><div className="occupancy-ring" style={{ background: `conic-gradient(var(--accent) ${percent}%, var(--surface-2) 0)` }}><strong>{dining ? `${percent}%` : '—'}</strong></div><p>{occupied} of {tables.length} active tables occupied</p><small>{active.reduce((n,v)=>n+v.guests,0)} seated guests · released tables become available</small></section>
      <section className="business-panel"><h3>Best sellers today</h3><p>Item sales before bill discounts and tax</p>{sales?.topItems?.slice(0,5).map((item: any, i: number) => <div className="business-row" key={item.name}><em>{String(i+1).padStart(2,'0')}</em><span>{item.name}<small>{item.qty} sold</small></span><b>{money(item.revenue_cents)}</b></div>)}{!sales?.topItems?.length && <p>No items sold today yet.</p>}<a href="#performance">Explore sales trends →</a></section>
      <section className="business-panel"><h3>Protect sales</h3><div className="business-row"><span>Low-stock items<small>Restock to keep menu items available</small></span><strong className={low.length ? 'attention-number' : ''}>{stock ? low.length : '—'}</strong></div>{low.slice(0,3).map((item: any) => <div className="business-row" key={item.id}><span>{item.name}</span><b>{item.quantity} {item.unit}</b></div>)}<div className="business-row"><span>Voided today<small>Excluded from sales</small></span><b>{sales ? money(sales.summary.void_cents) : '—'}</b></div><a href="#inventory">Review inventory →</a></section>
    </div>
    <p className="business-note">Sales are revenue, not profit. Ingredient costs and operating expenses are not tracked. Live activity reflects synchronized records.</p>
  </div>;
}
