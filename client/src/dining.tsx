import React, { useCallback, useEffect, useRef, useState } from 'react';
import { applyDining, linesOf, ticketState, totals } from '../../dining-domain.js';
import { diningRequest, enqueue, projected, readCache, synchronize, uid, updateCache, type Cache, type Snapshot } from './dining-store';
import './dining.css';
import DiscountEditor from './discount-editor';

const money = (n = 0) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n / 100);
const when = (s?: string) => s ? new Date(s).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const minutes = (a?: string, b = new Date().toISOString()) => a ? Math.max(0, Math.floor((Date.parse(b) - Date.parse(a)) / 60000)) : 0;
const labels: Record<string, string> = { arrived_at: 'Arrival', first_order_at: 'First order', eating_started_at: 'Start eating', eating_finished_at: 'Finish eating', bill_requested_at: 'Request bill', settled_at: 'Payment', released_at: 'Table released' };

function useDining(role: string) {
  const [cache, setCache] = useState<Cache | null>(null), [online, setOnline] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const sync = useCallback(async () => {
    try { await synchronize(role); setOnline(true); }
    catch (e) { setOnline(false); if ((e as any).status) setError((e as Error).message); }
  }, [role]);
  useEffect(() => {
    let active = true;
    const load = () => { void readCache().then(c => { if (active) setCache(c); }).catch(e => setError(`Offline storage: ${e.message}`)); };
    load(); void sync();
    const id = window.setInterval(() => void sync(), 15000);
    window.addEventListener('dining.cache', load); window.addEventListener('online', sync); window.addEventListener('dining.live', sync);
    return () => { active = false; clearInterval(id); window.removeEventListener('dining.cache', load); window.removeEventListener('online', sync); window.removeEventListener('dining.live', sync); };
  }, [sync]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const act = (type: string, id: string, payload: any, expectedVersion?: number) => run(async () => { await enqueue(role, type, id, payload, expectedVersion); void sync(); });
  return { role, cache, state: cache ? projected(cache, role) : null, online, error, busy, act, run, sync, setError };
}
type Service = ReturnType<typeof useDining>;
function SyncNotice({ service }: { service: Service }) {
  return <div className={`dining-sync ${service.online ? '' : 'offline'}`} role="status"><span className={`pill ${service.online ? 'ready' : 'void'}`}>{service.online ? 'Connected' : 'Offline / connecting'}</span>
    <span>{service.cache?.queue.length ?? 0} unsynced action(s)</span><button className="btn small" onClick={() => void service.sync()}>Sync now</button>
    {!service.online && <p>Saved on this tablet. Tell the kitchen directly; bills stay provisional until they sync.</p>}
    {service.error && <p className="dining-error" role="alert">{service.error}</p>}
    {!!service.cache?.queue.some(q => q.status === 'conflict') && <p className="dining-error">Some actions need owner review. Their original details and recorded cash are retained below.</p>}
  </div>;
}
function Outbox({ cache }: { cache: Cache }) {
  return cache.queue.length ? <details className="dining-outbox"><summary>Unsynced actions ({cache.queue.length})</summary>{cache.queue.map(q => <article key={q.operation.id}><b>{q.operation.type}</b> · {when(q.operation.at)} · {q.status}<p>{q.error}</p><OperationSummary operation={q.operation}/></article>)}</details> : null;
}
function useDraft<T>(key: string, initial: T, cache: Cache) {
  const [value, setValue] = useState<T>(cache.drafts[key] ?? initial), [error, setError] = useState('');
  const history = useRef<T[]>([]);
  const save = (next: T, remember = true) => {
    if (remember) history.current.push(structuredClone(value));
    setValue(next);
    void updateCache(c => { c.drafts[key] = next; }).catch(e => setError(`Draft could not be saved: ${e.message}`));
  };
  return { value, save, error, undo: () => { const previous = history.current.pop(); if (previous !== undefined) save(previous, false); }, canUndo: history.current.length > 0 };
}

export function DiningPos({ role }: { role: string }) {
  const service = useDining(role), [selected, setSelected] = useState<string | null>(null), [seat, setSeat] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(id); }, []);
  if (!service.state || !service.cache) return <div className="dining-workspace">Opening tables… {service.error}</div>;
  const { state, cache } = service, visit = selected ? state.visits[selected] : null;
  return <div className="dining-workspace"><SyncNotice service={service}/>
    {visit ? <><button className="btn" onClick={() => setSelected(null)}>← All tables</button><Visit key={visit.id} visit={visit} service={service}/></> : <>
      <h1>Unpaid tabs</h1><div className="dining-table-grid">{Object.values(state.tables).filter(t => t.active || t.visit_id).map(table => {
        const v = state.visits[table.visit_id];
        return <button className={`dining-table ${v ? 'occupied' : ''}`} key={table.id} onClick={() => v ? setSelected(v.id) : setSeat(table.id)}><strong>{table.name}</strong>{v ? <><span>{v.guests} guests · {minutes(v.arrived_at)} min</span><span>{v.alias} {v.vip ? 'VIP' : ''} {v.repeat ? 'Repeat guest' : ''}</span><b>{money(totals(v, state.taxRate).total_cents)}</b><span>{v.status} · {linesOf(v).filter(l => l.sends_to_kitchen).reduce((s, l) => s + l.ready_qty, 0)} / {linesOf(v).filter(l => l.sends_to_kitchen).reduce((s, l) => s + l.qty, 0)} ready</span></> : <span>Available · Seat guests</span>}</button>;
      })}</div>{!Object.keys(state.tables).length && <p>No tab tables yet. The owner adds them in Admin → Tables &amp; menu → Manage tables.</p>}
      <details><summary>Recent visits and feedback</summary>{Object.values(state.visits).sort((a, b) => b.arrived_at.localeCompare(a.arrived_at)).slice(0, 50).map(v => <button className="btn small" key={v.id} onClick={() => setSelected(v.id)}>{v.table_name} · {when(v.arrived_at)} · {v.status}</button>)}</details>
    </>}
    {seat && <section className="panel dining-seat"><h2>Seat guests · {state.tables[seat]?.name}</h2><SeatForm key={seat} cache={cache} tableId={seat} busy={service.busy} onCancel={() => setSeat(null)} onSeat={p => void service.run(async () => { await enqueue(role, 'table.seat', seat, p); setSeat(null); setSelected(p.visitId); void service.sync(); })}/></section>}
    <Outbox cache={cache}/>
  </div>;
}
function SeatForm({ cache, tableId, busy, onSeat, onCancel }: { cache: Cache; tableId: string; busy: boolean; onSeat: (p: any) => void; onCancel: () => void }) {
  const d = useDraft(`seat:${tableId}`, { guests: 1, alias: '', vip: false, repeat: false }, cache);
  return <form className="dining-form" onSubmit={e => { e.preventDefault(); onSeat({ ...d.value, visitId: uid() }); }}>
    <label>Guests<input type="number" min="1" max="999" required value={d.value.guests} onChange={e => d.save({ ...d.value, guests: Number(e.target.value) })}/></label>
    <label>Guest alias (optional)<input maxLength={80} value={d.value.alias} onChange={e => d.save({ ...d.value, alias: e.target.value })}/></label>
    <label className="check"><input type="checkbox" checked={d.value.vip} onChange={e => d.save({ ...d.value, vip: e.target.checked })}/>VIP</label><label className="check"><input type="checkbox" checked={d.value.repeat} onChange={e => d.save({ ...d.value, repeat: e.target.checked })}/>Repeat guest</label>
    <div className="dining-actions"><button type="button" className="btn" disabled={!d.canUndo} onClick={d.undo}>Undo draft</button><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy}>Seat guests</button></div>{d.error && <p role="alert">{d.error}</p>}
  </form>;
}
function Visit({ visit: v, service }: { visit: any; service: Service }) {
  const state = service.state!, cache = service.cache!, bill = v.bill ?? totals(v, state.taxRate), open = v.status === 'open';
  const feedback = useDraft(`feedback:${v.id}`, v.feedback ?? '', cache);
  const [editingLine, setEditingLine] = useState<any>(null), [showDetails, setShowDetails] = useState(false), [showDiscount, setShowDiscount] = useState(false), [cash, setCash] = useState(''), [cancelReason, setCancelReason] = useState('');
  return <section className="dining-visit"><header><h1>{v.table_name} <span className="pill">{v.status}</span></h1><p>{v.guests} guests · {v.alias} {v.vip && '· VIP'} {v.repeat && '· Repeat guest'} · {minutes(v.arrived_at, v.released_at ?? undefined)} min</p><button className="btn small" disabled={!open} onClick={() => setShowDetails(!showDetails)}>Edit party</button></header>
    {showDetails && <PartyForm key={v.version} visit={v} service={service} done={() => setShowDetails(false)}/>}
    <div className="dining-service-actions">{(['eating_started_at', 'eating_finished_at', 'bill_requested_at'] as const).map(event => <button className="btn" key={event} disabled={!open || !!v[event] || service.busy} onClick={() => void service.act('visit.event', v.id, { event })}>{labels[event]}{v[event] ? ` · ${when(v[event])}` : ''}</button>)}</div>
    <div className="dining-columns"><div><h2>Sent orders</h2>{v.submissions.map((s: any, index: number) => <article className="dining-submission" key={s.id}><h3>Order {index + 1} · {when(s.submitted_at)} <span className="pill">{ticketState(s)}</span></h3>{s.lines.map((l: any) => <div className={`dining-line ${l.qty === 0 ? 'cancelled' : ''}`} key={l.id}><div><b>{l.qty} × {l.name}</b> · {money(l.qty * l.unit_price_cents)}<p>{l.note}{l.sends_to_kitchen ? ` · ${l.ready_qty}/${l.qty} ready` : ' · No kitchen preparation'}</p>{l.changes.length > 0 && <details><summary>Changes / cancellations</summary>{l.changes.map((c: any, n: number) => <p key={n}>{when(c.at)} · Qty {c.previous_qty} → {c.qty} · {c.previous_note} → {c.note}</p>)}</details>}</div>{open && l.qty > 0 && <button className="btn small" onClick={() => setEditingLine({...l,visitVersion:v.version})}>Edit / remove</button>}</div>)}</article>)}{!v.submissions.length && <p>No orders sent yet.</p>}
      {editingLine && <form className="panel dining-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void service.act('visit.line', v.id, { lineId: editingLine.id, qty: Number(f.get('qty')), note: f.get('note') },editingLine.visitVersion); setEditingLine(null); }}><h3>Edit {editingLine.name}</h3><label>Quantity (0 removes item)<input name="qty" type="number" min="0" max={editingLine.qty} defaultValue={editingLine.qty} required/></label><label>Preparation note<textarea name="note" maxLength={300} defaultValue={editingLine.note}/></label><p>Add extra quantities through a new order below so they keep their queue position.</p><div className="dining-actions"><button type="button" className="btn" onClick={() => setEditingLine(null)}>Cancel</button><button className="btn primary" disabled={service.busy}>Save change</button></div></form>}
      {open && <OrderDraft key={v.id} visit={v} service={service}/>}
    </div><aside className="panel dining-bill"><h2>Bill</h2><dl className="totals"><dt>Subtotal</dt><dd>{money(bill.subtotal_cents)}</dd><dt>Discount {v.discount?.label}</dt><dd>−{money(bill.discount_cents)}</dd><dt>Tax</dt><dd>{money(bill.tax_cents)}</dd><dt className="grand">Total</dt><dd className="grand">{money(bill.total_cents)}</dd></dl>{v.discount && <p>{v.discount.reason}</p>}
      {open && <><button className="btn" onClick={() => setShowDiscount(!showDiscount)}>Discount</button>{showDiscount && <DiscountForm visit={v} service={service} done={() => setShowDiscount(false)}/>}
        <label>Cash received<input type="number" min="0" step="0.01" value={cash} onChange={e => setCash(e.target.value)}/></label><button className="btn small" onClick={() => setCash((bill.total_cents / 100).toFixed(2))}>Exact</button><p>Change: {money(Math.max(0, Math.round(Number(cash) * 100) - bill.total_cents))}</p><button className="btn primary big" disabled={service.busy || !v.bill_requested_at || !linesOf(v).some(l => l.qty) || Math.round(Number(cash) * 100) < bill.total_cents} onClick={() => void service.act('visit.settle', v.id, { cash_cents: Math.round(Number(cash) * 100), total_cents: bill.total_cents })}>Settle cash bill</button>
        <details><summary>Cancel visit</summary><label>Cancellation reason<input maxLength={200} value={cancelReason} onChange={e => setCancelReason(e.target.value)}/></label><button className="btn danger" disabled={!cancelReason.trim() || service.busy} onClick={() => void service.act('visit.cancel', v.id, { reason: cancelReason })}>Cancel visit</button></details></>}
      {v.settled_at && <><p>{v.receipt_no ? `Receipt #${v.receipt_no}` : 'PROVISIONAL · awaiting synchronization'}</p><p>Cash {money(v.cash_cents)} · Change {money(v.change_cents)}</p><button className="btn" onClick={() => window.print()}>Print bill / receipt</button></>}
      {!open && !v.released_at && <button className="btn primary" disabled={service.busy} onClick={() => void service.act('visit.release', v.id, {})}>Release table</button>}
      <details className="dining-times"><summary>Service times</summary>{Object.entries(labels).map(([key, label]) => <p key={key}>{label}: {when(v[key])}</p>)}</details>
    </aside></div>
    <details className="panel dining-feedback"><summary>Customer feedback</summary><textarea aria-label="Customer experience feedback" rows={3} maxLength={4000} value={feedback.value} onChange={e => feedback.save(e.target.value)}/><div className="dining-actions"><button className="btn" disabled={!feedback.canUndo} onClick={feedback.undo}>Undo draft</button><button className="btn" disabled={service.busy} onClick={() => void service.act('visit.feedback', v.id, { feedback: feedback.value })}>Save feedback</button></div>{feedback.error}</details>
    {v.settled_at && <DiningReceipt visit={v} bill={bill} config={state.receipt}/>}
  </section>;
}
function PartyForm({ visit, service, done }: { visit: any; service: Service; done: () => void }) {
  return <form className="panel dining-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void service.act('visit.details', visit.id, { guests: Number(f.get('guests')), alias: f.get('alias'), vip: f.has('vip'), repeat: f.has('repeat') }); done(); }}><label>Guests<input name="guests" type="number" min="1" max="999" defaultValue={visit.guests} required/></label><label>Alias<input name="alias" maxLength={80} defaultValue={visit.alias}/></label><label className="check"><input name="vip" type="checkbox" defaultChecked={visit.vip}/>VIP</label><label className="check"><input name="repeat" type="checkbox" defaultChecked={visit.repeat}/>Repeat guest</label><button className="btn primary">Save party</button></form>;
}
function OrderDraft({ visit, service }: { visit: any; service: Service }) {
  const draft = useDraft<any[]>(`order:${visit.id}`, [], service.cache!), [query, setQuery] = useState('');
  const menu = service.state!.menu.filter(m => `${m.name} ${m.category}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel"><h2>Add an order</h2><input className="search" aria-label="Search table menu" placeholder="Find a menu item" value={query} onChange={e => setQuery(e.target.value)}/><div className="dining-menu">{menu.map(m => <button key={m.id} className="btn" disabled={!m.available} onClick={() => draft.save([...draft.value, { id: uid(), menu_item_id: m.id, name: m.name, unit_price_cents: m.price_cents, sends_to_kitchen: m.sends_to_kitchen, qty: 1, note: '' }])}>{m.name}<small>{m.category} · {money(m.price_cents)}{!m.available ? ' · Unavailable' : ''}</small></button>)}</div>
    {draft.value.map((l, i) => <div className="dining-draft-line" key={l.id}><b>{l.name}</b><label>Quantity<input type="number" min="1" max="99" value={l.qty} onChange={e => draft.save(draft.value.map((x, n) => n === i ? { ...x, qty: Number(e.target.value) } : x))}/></label><label>Preparation note<input maxLength={300} value={l.note} onChange={e => draft.save(draft.value.map((x, n) => n === i ? { ...x, note: e.target.value } : x))}/></label><button className="btn small" onClick={() => draft.save(draft.value.filter((_, n) => n !== i))}>Remove</button></div>)}
    <div className="dining-actions"><button className="btn" disabled={!draft.canUndo} onClick={draft.undo}>Undo draft</button><button className="btn" onClick={() => draft.save([])}>Clear draft</button><button className="btn primary" disabled={!draft.value.length || service.busy} onClick={() => void service.run(async () => { await enqueue(serviceRole(service), 'visit.submit', visit.id, { submissionId: uid(), lines: draft.value }); draft.save([]); void service.sync(); })}>Send order to kitchen</button></div>{draft.error && <p role="alert">{draft.error}</p>}
  </section>;
}
// The authenticated role is attached by the host, rather than inferred from a cached record.
function serviceRole(service: Service) { return service.role; }
function DiscountForm({ visit, service, done }: { visit: any; service: Service; done: () => void }) {
  const initialVersion=useRef(visit.version);
  return <DiscountEditor discount={visit.discount} busy={service.busy} onClose={done} onSave={discount=>void service.run(async()=>{await enqueue(service.role,'visit.discount',visit.id,{discount},initialVersion.current);done();void service.sync();})}/>;
}
function DiningReceipt({ visit: v, bill, config }: { visit: any; bill: any; config?: Snapshot['receipt'] }) {
  return <div className="print-receipt dining-print"><div className="r-center r-name">Café Ambiente</div><p>{v.receipt_no ? `Receipt #${v.receipt_no}` : 'PROVISIONAL · OFFLINE BILL'}</p><p>{v.table_name} · {v.guests} guests · {when(v.settled_at)}</p>{linesOf(v).filter(l => l.qty).map(l => <div className="r-row" key={l.id}><span>{l.qty} × {l.name}</span><span>{money(l.qty * l.unit_price_cents)}</span></div>)}<hr/><div className="r-row"><span>Subtotal</span><span>{money(bill.subtotal_cents)}</span></div><div className="r-row"><span>Discount {v.discount?.label}</span><span>−{money(bill.discount_cents)}</span></div>{v.discount && <p>{v.discount.reason}</p>}<div className="r-row"><span>Tax</span><span>{money(bill.tax_cents)}</span></div><div className="r-row r-total"><strong>Total</strong><strong>{money(bill.total_cents)}</strong></div><div className="r-row"><span>Cash</span><span>{money(v.cash_cents)}</span></div><div className="r-row"><span>Change</span><span>{money(v.change_cents)}</span></div>{v.status === 'refunded' && <p>REFUNDED / VOIDED</p>}{(config?.footer??['Thank you! Please come again.']).map((line,index)=><p className="r-center" key={index}>{line}</p>)}</div>;
}

export function DiningKitchen({ role, started, chime, includeCounter = true, onCount }: { role: string; started: boolean; chime: () => void; includeCounter?: boolean; onCount?: (n: number) => void }) {
  const service = useDining(role), previous = useRef<Set<string> | null>(null);
  const state = service.state;
  const tickets: any[] = state ? [
    ...Object.values(state.visits).flatMap(v => v.submissions.filter((s: any) => ['new', 'preparing'].includes(ticketState(s)) || (s.change_seq ?? 0) > (s.acknowledged_seq ?? 0)).map((s: any) => ({ key: s.id, time: s.submitted_at, visit: v, submission: s, status: ticketState(s), lines: s.lines, title: v.table_name }))),
    ...Object.values(includeCounter ? state.counterOrders : {}).filter(o => ['new', 'preparing'].includes(o.kitchen_status)).map(o => ({ key: `counter:${o.id}`, time: o.created_at, order: o, status: o.kitchen_status, lines: o.items, title: `#${o.receipt_label}` })),
  ].sort((a, b) => a.time.localeCompare(b.time) || a.key.localeCompare(b.key)) : [];
  useEffect(() => {
    const keys = new Set(tickets.filter(t => ['new', 'preparing'].includes(t.status)).map(t => t.key));
    if (started && previous.current && [...keys].some(k => !previous.current!.has(k))) chime();
    previous.current = keys;
  }, [tickets.map(t => t.key).join('|'), started]);
  useEffect(() => { onCount?.(tickets.length); }, [tickets.length, onCount]);
  if (!state) return <p>Opening kitchen tickets… {service.error}</p>;
  const update = (ticket: any, payload: any) => ticket.order ? service.act('counter.kitchen', String(ticket.order.id), payload) : service.act(payload.ack ? 'kitchen.ack' : payload.lineId ? 'kitchen.line' : payload.status === 'ready' ? 'kitchen.ready' : 'kitchen.start', ticket.visit.id, { ...payload, submissionId: ticket.submission.id });
  return <div className="dining-kitchen"><SyncNotice service={service}/><main className="tickets">{tickets.map(t => <article className={`ticket ${t.status} ${minutes(t.time) >= 10 ? 'late' : ''}`} key={t.key}><div className="ticket-head"><h2>{t.title}</h2><span>{minutes(t.time)} min · {when(t.time)}</span></div><div className="ticket-state">{t.status}{t.submission?.cancel_reason&&<p>{t.submission.cancel_reason}</p>}</div><ul>{t.lines.filter((l: any) => l.sends_to_kitchen !== 0).map((l: any) => <li key={l.id} className={l.qty === 0 ? 'cancelled' : ''}><div><b>{l.qty} × {l.name}</b>{l.note && <p>{l.note}</p>}{!!l.changes?.length && <p className="dining-error">Changed: {l.changes.map((c: any) => `${c.previous_qty} → ${c.qty}${c.previous_note !== c.note ? `; note: ${c.note}` : ''}`).join(' · ')}</p>}<p>{l.ready_qty} / {l.qty} ready</p></div>{l.qty > 0 && <div className="dining-actions"><button className="btn small" disabled={service.busy || t.status==='cancelled' || !l.ready_qty} onClick={() => void update(t, { lineId: l.id, ready_qty: l.ready_qty - 1 })}>− ready</button><button className="btn small" disabled={service.busy || t.status==='cancelled' || l.ready_qty >= l.qty} onClick={() => void update(t, { lineId: l.id, ready_qty: l.ready_qty + 1 })}>+ ready</button></div>}</li>)}</ul>{t.submission&&(t.submission.change_seq??0)>(t.submission.acknowledged_seq??0)&&<button className="btn" disabled={service.busy} onClick={()=>void update(t,{ack:true})}>Acknowledge changes / cancellation</button>}{['new', 'preparing'].includes(t.status) && <button className="btn primary" disabled={service.busy} onClick={() => void update(t, { status: t.status === 'new' ? 'preparing' : 'ready' })}>{t.status === 'new' ? 'Start' : 'Order Ready'}</button>}</article>)}{!tickets.length && !onCount && <p className="kitchen-empty">No open tickets</p>}</main>{service.cache && <Outbox cache={service.cache}/>}{!onCount && <DiningHistory role={role} refresh={service.sync}/>}</div>;
}

function OperationSummary({ operation: op }: { operation: any }) {
  const p = op.payload;
  return <div className="dining-operation"><span>{p.guests ? `${p.guests} guests · ${p.alias ?? ''}` : ''}</span>{p.lines?.map((l: any) => <p key={l.id}>{l.qty} × {l.name} · {money(l.unit_price_cents * l.qty)} · {l.note}</p>)}{p.cash_cents != null && <p>Cash collected: <b>{money(p.cash_cents)}</b> · Bill: {money(p.total_cents)} · Change: {money(p.cash_cents - p.total_cents)}</p>}{p.qty != null && <p>Quantity: {p.qty} · {p.note}</p>}{p.discount && <p>Discount: {p.discount.kind === 'percent' ? `${p.discount.value / 100}%` : money(p.discount.value)} · {p.discount.reason}</p>}{p.event && <p>{labels[p.event]}</p>}{p.feedback && <p>{p.feedback}</p>}{p.reason && <p>{p.reason}</p>}</div>;
}

export function DiningHistory({ role, refresh, open = false }: { role: string; refresh?: () => Promise<void>; open?: boolean }) {
  const [rows, setRows] = useState<any[]>([]), [business, setBusiness] = useState<any[]>([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const [a, b] = await Promise.all([diningRequest('/history'), diningRequest('/business-history')]); setRows(a); setBusiness(b); } catch { /* Offline history remains visible after disconnect. */ }
  }, []);
  useEffect(() => { void load(); window.addEventListener('dining.live', load); window.addEventListener('dining.business', load); return () => { window.removeEventListener('dining.live', load); window.removeEventListener('dining.business', load); }; }, [load]);
  const undo = async (id: string, saved: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await diningRequest(saved ? `/business-undo/${id}` : `/undo/${id}`, {});
      setMessage(result.refund_cents ? `Return ${money(result.refund_cents)} to the customer.` : result.cash_correction_cents < 0 ? `Return ${money(-result.cash_correction_cents)} to the customer.` : result.cash_correction_cents > 0 ? `Collect ${money(result.cash_correction_cents)} from the customer.` : 'Action reversed.');
      await load(); await refresh?.(); window.dispatchEvent(new Event('dining.business')); window.dispatchEvent(new Event('dining.live'));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <details className="panel dining-history" open={open}><summary>Saved actions and Undo</summary><button className="btn small" onClick={() => void load()}>Refresh history</button>{error && <p className="dining-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}{[...rows.filter(r => r.status === 'applied' && r.changes?.length).map(r => ({ id: r.id, at: r.at, title: r.operation.type, who: r.actor_name, reversed: r.reversed_by, saved: false, canUndo: r.operation.type !== 'undo', operation: r.operation })), ...business.map(r => ({ id: r.id, at: r.at, title: `${r.kind} #${r.target_id}`, who: r.actor_name, reversed: r.reversed_by, saved: true, canUndo: !r.note?.startsWith('Reversal'), operation: null }))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100).map(r => <article key={r.id}><span>{when(r.at)} · {r.who} · <b>{r.title}</b></span>{r.reversed ? <span className="pill">Reversed</span> : r.canUndo && <button className="btn small" disabled={busy} onClick={() => void undo(r.id, r.saved)}>Undo</button>}{r.operation && <OperationSummary operation={r.operation}/>}</article>)}<p>Undo checks permissions and later changes. Payment reversals retain the receipt and record the cash correction.</p></details>;
}

export function DiningAdmin() {
  const service = useDining('admin'), [history, setHistory] = useState<any[]>([]), [table, setTable] = useState<any>(null), [menuItem, setMenuItem] = useState<any>(null), [query, setQuery] = useState(''), [correction, setCorrection] = useState<any>(null);
  const load = useCallback(async () => {
    try { setHistory(await diningRequest('/history')); } catch (e) { service.setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); window.addEventListener('dining.live', load); return () => window.removeEventListener('dining.live', load); }, [load]);
  if (!service.state || !service.cache) return <section className="panel">Opening table service… {service.error}</section>;
  const state = service.state;
  return <section className="panel dining-admin"><h2>Table service</h2><SyncNotice service={service}/>
    <details><summary>Manage tables</summary><button className="btn" onClick={() => setTable({ id: uid(), name: '', active: true })}>Add table</button><div className="dining-table-grid">{Object.values(state.tables).map(t => <button className="btn" key={t.id} onClick={() => setTable(t)}>{t.name} · {t.active ? 'Active' : 'Inactive'}{t.visit_id ? ' · Occupied' : ''}</button>)}</div>{table && <form className="dining-form" key={table.id} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void service.act('table.save', table.id, { name: f.get('name'), active: f.has('active') },table.version??0); setTable(null); }}><label>Table name<input name="name" maxLength={60} defaultValue={table.name} required/></label><label className="check"><input name="active" type="checkbox" defaultChecked={table.active}/>Active</label><div className="dining-actions"><button className="btn primary">Save table</button><button className="btn" type="button" onClick={() => setTable(null)}>Cancel</button></div></form>}</details>
    <details><summary>Edit menu</summary><input className="search" placeholder="Find menu item" value={query} onChange={e => setQuery(e.target.value)}/><div className="dining-menu">{state.menu.filter(m => `${m.name} ${m.category}`.toLowerCase().includes(query.toLowerCase())).map(m => <button className="btn" key={m.id} onClick={() => setMenuItem(m)}>{m.name}<small>{m.category} · {money(m.price_cents)}</small></button>)}</div>{menuItem && <form className="dining-form" key={menuItem.id} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void service.run(async () => { await diningRequest(`/menu/${menuItem.id}`, { expectedVersion: menuItem.version, name: f.get('name'), category: f.get('category'), price_cents: Math.round(Number(f.get('price')) * 100), available: f.has('available'), sends_to_kitchen: f.has('kitchen') }, 'PATCH'); setMenuItem(null); await service.sync(); window.dispatchEvent(new Event('dining.live')); }); }}><label>Name<input name="name" defaultValue={menuItem.name} required maxLength={120}/></label><label>Category<input name="category" defaultValue={menuItem.category} required maxLength={80}/></label><label>Price (pesos)<input name="price" type="number" step="0.01" min="0.01" defaultValue={menuItem.price_cents / 100} required/></label><label className="check"><input type="checkbox" name="available" defaultChecked={!!menuItem.available}/>Available</label><label className="check"><input type="checkbox" name="kitchen" defaultChecked={!!menuItem.sends_to_kitchen}/>Kitchen preparation</label><div className="dining-actions"><button className="btn primary" disabled={service.busy}>Save menu item</button><button className="btn" type="button" onClick={() => setMenuItem(null)}>Cancel</button></div></form>}</details>
    <h3>Offline conflicts</h3>{history.filter(r => r.status === 'conflict').map(r => <Conflict key={r.id} row={r} state={state} resolve={async body => { await diningRequest(`/conflicts/${r.id}/resolve`, body); await service.sync(); await load(); window.dispatchEvent(new Event('dining.live')); }} run={service.run}/>)}{!history.some(r => r.status === 'conflict') && <p>No conflicts waiting for review.</p>}
    <details><summary>Customer feedback and service timestamps</summary>{Object.values(state.visits).sort((a, b) => b.arrived_at.localeCompare(a.arrived_at)).map(v => <article className="dining-submission" key={v.id}><b>{v.table_name}</b> · {when(v.arrived_at)} · {v.alias} · {v.status}<p>{v.feedback || 'No feedback recorded'}</p><button className="btn small" onClick={() => setCorrection(v)}>Correct a timestamp</button></article>)}</details>
    {correction && <form className="dining-form panel" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const value = `${f.get('value')}:00+08:00`; void service.act('visit.correct-time', correction.id, { event: f.get('event'), value, reason: f.get('reason') }); setCorrection(null); }}><h3>Correct service time · {correction.table_name}</h3><label>Event<select name="event">{Object.entries(labels).filter(([key]) => correction[key]).map(([key, label]) => <option value={key} key={key}>{label} · {when(correction[key])}</option>)}</select></label><label>Correct time (Manila)<input type="datetime-local" name="value" required/></label><label>Reason<input name="reason" required maxLength={200}/></label><div className="dining-actions"><button className="btn primary">Save correction</button><button className="btn" type="button" onClick={() => setCorrection(null)}>Cancel</button></div></form>}
    <Outbox cache={service.cache}/><DiningHistory role="admin" refresh={service.sync}/>
  </section>;
}
function Conflict({ row, state, resolve, run }: { row: any; state: Snapshot; resolve: (body: any) => Promise<void>; run: Service['run'] }) {
  const op = row.operation, current = op.type === 'counter.kitchen' ? state.counterOrders[op.targetId] : op.type.startsWith('table.') ? state.tables[op.targetId] : state.visits[op.targetId];
  const [target, setTarget] = useState(op.targetId), [cashConfirmed, setCashConfirmed] = useState(false);
  const selected = op.type.startsWith('table.') ? state.tables[target] : current;
  return <form className="dining-conflict" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget), action = String(f.get('action')), payload = structuredClone(op.payload); void run(async () => {
    if (op.type === 'visit.submit') payload.lines = payload.lines.map((l: any) => { const m = state.menu.find(m => m.id === l.menu_item_id); return m ? { ...l, name: m.name, unit_price_cents: m.price_cents, sends_to_kitchen: m.sends_to_kitchen } : l; });
    if (op.type === 'visit.settle' && selected) payload.total_cents = totals(selected, state.taxRate).total_cents;
    if (op.type === 'visit.line') { payload.qty = Number(f.get('qty')); payload.note = f.get('prepNote'); }
    const replacement = { ...op, id: uid(), at: op.at, targetId: target, expectedVersion: selected?.version ?? 0, payload };
    delete replacement.dependsOn;
    // Show validation errors before creating another conflict on the server.
    if (action === 'retry') applyDining(state, replacement, { role: 'admin', menu: state.menu, taxRate: state.taxRate });
    await resolve({ action, note: f.get('note'), cashCorrectionCents: Math.round(Number(f.get('cashCorrection')) * 100), operation: replacement });
  }); }}><h4>{op.type} · {when(op.at)} · {row.actor_name}</h4><p className="dining-error">{row.error}</p><div className="dining-columns"><div><b>Recorded on device</b><OperationSummary operation={op}/></div><div><b>Current server record</b><p>{selected?.name ?? selected?.table_name ?? 'Record missing'} · {selected?.status ?? (selected?.visit_id ? 'Occupied' : 'Available')}</p>{selected?.submissions && <><p>Current total: {money(totals(selected, state.taxRate).total_cents)}</p>{linesOf(selected).map(l => <p key={l.id}>{l.qty} × {l.name} · {money(l.qty * l.unit_price_cents)} · {l.note}</p>)}</>}</div></div>
    {op.type === 'table.seat' && <label>Table for this party<select value={target} onChange={e => setTarget(e.target.value)}>{Object.values(state.tables).map(t => <option value={t.id} key={t.id}>{t.name} {t.visit_id ? '(occupied)' : '(available)'}</option>)}</select></label>}
    {op.type === 'visit.line' && <><label>Resolved quantity<input name="qty" type="number" min="0" defaultValue={op.payload.qty} required/></label><label>Resolved preparation note<input name="prepNote" maxLength={300} defaultValue={op.payload.note}/></label></>}
    <label>Resolution<select name="action"><option value="retry">Apply recorded action to the current record</option><option value="dismiss">Dismiss recorded action; keep current record</option></select></label><p>Menu submissions use current menu details when retried. Payment retries use the current bill total and retain recorded cash. A dismissed payment must be refunded or accounted for in the cash correction below.</p>
    <label>Cash correction in pesos (positive collect, negative return, 0 none)<input name="cashCorrection" type="number" step="0.01" defaultValue="0" required/></label><label>Resolution / cash handling note<textarea name="note" required maxLength={1000}/></label><label className="check"><input type="checkbox" checked={cashConfirmed} onChange={e => setCashConfirmed(e.target.checked)}/>I reviewed the recorded cash, change, and any cash correction.</label><button className="btn primary" disabled={!cashConfirmed}>Record resolution</button>
  </form>;
}
