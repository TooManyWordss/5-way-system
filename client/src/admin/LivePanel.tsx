import { useCallback, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { money, time } from '../shared/format';
import { storeUrl } from '../shared/store';
import type { DayReport, DiningTable, Line, Order, Role } from '../shared/types';
import { FloorMap } from '../tables/FloorMap';

// The owner's general panel: every station at once, live. Which screens are open, both tills' sales,
// the kitchen queue item by item, the tables and the stock to buy, with one tap into any screen.
const SCREENS: [Role, string][] = [['pos', 'POS'], ['barista', 'Barista'], ['kitchen', 'Kitchen'], ['inventory', 'Inventory'], ['admin', 'Owner']];
const itemState = (i: Line) => i.kitchen_ready_at ? 'ready' : i.kitchen_started_at ? 'cooking' : 'waiting';
const minutesAgo = (date: string, now: number) => Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
const waited = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;

export function LivePanel({ tables, lowStock, liveTick, screens }: {
  tables: DiningTable[]; lowStock: { id: number; name: string; quantity: number; unit: string }[];
  liveTick: number; screens: Record<string, number> | null;
}) {
  const [report, setReport] = useState<DayReport | null>(null), [tickets, setTickets] = useState<Order[]>([]), [counts, setCounts] = useState<Record<string, number> | null>(screens), [now, setNow] = useState(Date.now());
  const load = useCallback(() => {
    void api<DayReport>('/api/admin/day').then(setReport).catch(() => {});
    void api<Order[]>('/api/kitchen/tickets').then(setTickets).catch(() => {});
    void api<Record<string, number>>('/api/admin/screens').then(setCounts).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, liveTick]);
  useEffect(() => { if (screens) setCounts(screens); }, [screens]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const paid = (report?.orders ?? []).filter(o => o.status !== 'voided');
  const till = (station: string) => { const list = paid.filter(o => (o.station === 'barista') === (station === 'barista')); return { total: list.reduce((n, o) => n + o.total_cents, 0), count: list.length }; };
  const latest = [...(report?.orders ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
  const open = tickets.filter(o => ['new', 'preparing'].includes(o.kitchen_status ?? '')), taken = tables.filter(t => t.party).length;

  return <div className="live-panel">
    <section className="lp-screens" aria-label="Screens">
      {SCREENS.map(([role, label]) => { const n = counts?.[role] ?? 0; return <a key={role} className={`lp-screen ${n ? 'on' : ''}`} href={storeUrl(`/${role}`)}>
        <span className="lp-dot" aria-hidden="true" /><span className="lp-screen-name">{label}</span>
        <span className="lp-screen-state">{n ? (n === 1 ? 'Open' : `${n} open`) : 'Not open'}</span><span className="lp-open">Open ›</span>
      </a>; })}
    </section>
    <div className="lp-grid">
      <section className="panel lp-tills"><h2>Tills today</h2>
        <div className="lp-tiles">{[['cashier', 'Cashier'], ['barista', 'Barista']].map(([station, label]) => { const t = till(station); return <div className="lp-tile" key={station}><span>{label}</span><strong>{money(t.total)}</strong><small>{t.count} receipt{t.count === 1 ? '' : 's'}</small></div>; })}</div>
        <h3>Latest receipts</h3>
        <ul className="lp-list">{latest.map(o => <li key={o.id} className={o.status === 'voided' ? 'voided' : ''}><span className="lp-time">{time(o.created_at)}</span><span>#{o.receipt_label ?? o.receipt_no}{o.table_name ? ` · ${o.table_name}` : ''}{o.station === 'barista' ? ' · Barista' : ''}{o.status === 'voided' ? ' · Voided' : ''}</span><b>{money(o.total_cents)}</b></li>)}
          {!latest.length && <li className="lp-empty">No sales yet today</li>}</ul>
      </section>
      <section className="panel lp-kitchen"><h2>Kitchen <span className="pill">{open.length} open</span></h2>
        <div className="lp-tickets">{open.map(o => { const age = minutesAgo(o.created_at, now), items = o.items.filter(i => i.sends_to_kitchen !== 0), ready = items.filter(i => i.kitchen_ready_at).length;
          return <article key={o.id} className={`lp-ticket ${age >= 10 ? 'late' : ''}`}><header><b>#{o.receipt_label ?? o.receipt_no}</b><span>{o.table_name ?? 'Takeout'}</span><span className="lp-age">{waited(age)}</span></header>
            <ul>{items.map((i, n) => { const st = itemState(i); return <li key={i.id ?? n} className={st}><span className="lp-state" aria-label={st}>{st === 'ready' ? '✓' : st === 'cooking' ? '🔥' : '○'}</span>{i.qty}× {i.name}</li>; })}</ul>
            <footer>{ready} of {items.length} ready</footer></article>; })}
          {!open.length && <p className="lp-empty">No open tickets</p>}</div>
      </section>
      <section className="panel lp-tables"><h2>Tables <span className="pill">{taken} of {tables.length} taken</span></h2>
        {tables.length > 0 && <FloorMap tables={tables} onPick={() => {}} />}
        <h3>Stock to buy</h3>
        <ul className="lp-list">{lowStock.map(i => <li key={i.id}><span>{i.name}</span><b>{i.quantity} {i.unit} left</b></li>)}{!lowStock.length && <li className="lp-empty">Nothing to buy</li>}</ul>
      </section>
    </div>
  </div>;
}
