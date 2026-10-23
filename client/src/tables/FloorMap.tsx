import React, { useId, useRef, useState } from 'react';
import { time } from '../shared/format';
import { STORE } from '../shared/store';
import type { DiningTable } from '../shared/types';
import { CHAIR, chairsFor, couchFor, isCouch, minutesSince, tableLabel } from './tables';

// The dining room as drawn by the owner. Tap a table to pick it; in admin, drag tables to move them.
export function FloorMap({ tables, selectedId, onPick, onMove }: { tables: DiningTable[]; selectedId?: number | null; onPick: (t: DiningTable) => void; onMove?: (t: DiningTable, x: number, y: number) => void }) {
  const svg = useRef<SVGSVGElement>(null), ids = useId().replace(/[^a-zA-Z0-9]/g, ''), shadow = `fm-shadow-${ids}`, floor = `fm-floor-${ids}`;
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const point = (e: React.PointerEvent) => { const p = svg.current!.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.current!.getScreenCTM()!.inverse()); };
  return <div className="floor-map"><svg ref={svg} viewBox="0 70 1280 640" role="group" aria-label="Floor map"
    onPointerMove={e => { if (!drag) return; const p = point(e); setDrag({ ...drag, x: Math.max(0, Math.min(1240, p.x - drag.dx)), y: Math.max(70, Math.min(690, p.y - drag.dy)), moved: true }); }}
    onPointerUp={() => { if (!drag) return; const t = tables.find(x => x.id === drag.id); if (t && drag.moved) onMove?.(t, drag.x, drag.y); else if (t) onPick(t); setDrag(null); }}>
    <defs>
      <filter id={shadow} x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#3a2314" floodOpacity=".22" /></filter>
      <pattern id={floor} width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="16" cy="16" r="1.4" className="fm-floor-dot" /></pattern>
    </defs>
    <rect className="fm-room" x="14" y="76" width="1252" height="628" rx="18" />
    <rect x="14" y="76" width="1252" height="628" rx="18" fill={`url(#${floor})`} />
    {STORE === 'ambiente' && <g className="fm-decor" aria-hidden="true">
      <rect className="fm-balcony" x="100" y="84" width="166" height="508" rx="14" /><text className="fm-area-label" x="183" y="105">BALCONY</text>
      <path className="fm-cashier" d="M300 345 H500 L505 310 H670 V705 H300 Z" /><text className="fm-area-label" x="485" y="520">CASHIER</text>
      <line className="fm-entrance" x1="550" y1="78" x2="690" y2="78" /><text className="fm-area-label" x="620" y="106">ENTRANCE</text>
    </g>}
    {tables.map(t => { const x = drag?.id === t.id ? drag.x : t.x, y = drag?.id === t.id ? drag.y : t.y, size = Math.min(20, t.w / Math.max(2, tableLabel(t.name).length) * 1.5);
      return <g key={t.id} className={`fm-table ${t.party ? 'busy' : ''} ${selectedId === t.id ? 'selected' : ''} ${onMove ? 'movable' : ''}`} role="button" tabIndex={0} aria-label={`${t.name}, ${t.seats} seats, ${t.party ? `occupied ${minutesSince(t.party.seated_at)} min` : 'free'}`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(t); } }}
        onPointerDown={e => { if (onMove) { const p = point(e); (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); setDrag({ id: t.id, dx: p.x - t.x, dy: p.y - t.y, x: t.x, y: t.y, moved: false }); } }}
        onClick={() => { if (!onMove) onPick(t); }}>
        <title>{t.name} · {t.seats} seats{t.party ? ` · seated ${time(t.party.seated_at)}` : ''}</title>
        <rect className="fm-hit" x={x - 26} y={y - 26} width={t.w + 52} height={t.h + 52} />
        {chairsFor(t, x, y).map((c, i) => <rect key={i} className="fm-chair" x={c.x} y={c.y} width={CHAIR} height={CHAIR} rx="5" />)}
        {isCouch(t.name) && (({ frame, cushions }) => <>{frame.map((r, i) => <rect key={`f${i}`} className="fm-couch" x={r.x} y={r.y} width={r.w} height={r.h} rx="9" />)}{cushions.map((c, i) => <rect key={`c${i}`} className="fm-chair" x={c.x} y={c.y} width={c.w} height={c.h} rx="5" />)}</>)(couchFor(t, x, y))}
        <rect className="fm-top" x={x} y={y} width={t.w} height={t.h} rx={t.seats <= 2 ? 10 : 9} filter={`url(#${shadow})`} />
        <text x={x + t.w / 2} y={y + t.h / 2} fontSize={size}>{tableLabel(t.name)}</text>
      </g>; })}
  </svg><div className="fm-key"><span><i className="fm-swatch" />Free</span><span><i className="fm-swatch busy" />Occupied</span><span><i className="fm-swatch selected" />Selected</span></div></div>;
}
