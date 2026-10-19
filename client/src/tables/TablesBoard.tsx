import { useEffect, useState } from 'react';
import { money, time } from '../shared/format';
import type { DiningTable, TableChoice } from '../shared/types';
import { FloorMap } from './FloorMap';
import { minutesSince, tagName } from './tables';

// Choose a table for the next sale, see who's sitting where, and bill a table out.
export function TablesBoard({ tables, chosenId, onChoose, onBillOut, onTakeout, compact = false }: { tables: DiningTable[]; chosenId?: number | null; onChoose: (c: TableChoice) => void; onBillOut: (t: DiningTable) => void; onTakeout?: () => void; compact?: boolean }) {
  const [selectedId, setSelectedId] = useState<number | null>(chosenId ?? null), [guests, setGuests] = useState(2), [tag, setTag] = useState<'vip' | 'repeat' | null>(null);
  const t = tables.find(x => x.id === selectedId);
  useEffect(() => { setSelectedId(chosenId ?? null); }, [chosenId]);
  useEffect(() => { if (t && !t.party) { setGuests(Math.min(2, t.seats)); setTag(null); } }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = tables.filter(x => x.party).length;
  return <div className={`tables-board${compact ? ' compact' : ''}`}><FloorMap tables={tables} selectedId={selectedId} onPick={x => setSelectedId(x.id)} />
    <div className="table-detail">{!t ? <p className="hint">{busy} of {tables.length} tables occupied. Tap a table on the map.</p> : t.party ? <>
      <h3>{t.name} <span className="pill void">Occupied</span>{t.party.customer_tag && <span className="pill">{tagName(t.party.customer_tag)}</span>}</h3>
      <p>Seated {time(t.party.seated_at)} · {minutesSince(t.party.seated_at)} min{t.party.guests ? ` · ${t.party.guests} guests` : ''}</p>
      <p>{t.party.receipts.map(r => `#${r.label} ${money(r.total_cents)} (${time(r.created_at)})`).join(' · ')} · <strong>{money(t.party.total_cents)}</strong></p>
      <div className="sheet-actions"><button className="btn danger-outline" onClick={() => { if (confirm(`Bill out ${t.name}? The table becomes free.`)) onBillOut(t); }}>Bill out · table free</button><button className="btn primary" onClick={() => onChoose({ id: t.id, name: t.name, guests: t.party!.guests, tag: (t.party!.customer_tag as any) ?? null, seatedAt: t.party!.seated_at })}>Add an order to {t.name}</button></div>
    </> : <>
      <h3>{t.name} <span className="pill ready">Free</span> <span className="hint">{t.seats} seats</span></h3>
      <div className="table-form"><span>Guests</span><span className="qty"><button type="button" aria-label="One fewer guest" onClick={() => setGuests(g => Math.max(1, g - 1))}>−</button><span>{guests}</span><button type="button" aria-label="One more guest" onClick={() => setGuests(g => Math.min(50, g + 1))}>+</button></span>
        {(['vip', 'repeat'] as const).map(v => <button type="button" key={v} className={`chip ${tag === v ? 'active' : ''}`} aria-pressed={tag === v} onClick={() => setTag(tag === v ? null : v)}>{tagName(v)}</button>)}</div>
      {chosenId === t.id && <p className="hint">Ordering for {t.name}. Add items, then complete the sale.</p>}<div className="sheet-actions"><button className="btn primary" onClick={() => onChoose({ id: t.id, name: t.name, guests, tag, seatedAt: new Date().toISOString() })}>{chosenId === t.id ? 'Update guests' : `Seat at ${t.name}`}</button></div>
    </>}{onTakeout && <button className="link" onClick={onTakeout}>No table · takeout</button>}</div>
    {!compact && <div className="table-chips" aria-label="All tables">{tables.map(x => <button key={x.id} className={`chip ${x.party ? 'busy' : ''} ${selectedId === x.id ? 'active' : ''}`} onClick={() => setSelectedId(x.id)}>{x.name}{x.party ? ` · ${minutesSince(x.party.seated_at)}m` : ''}</button>)}</div>}
  </div>;
}
