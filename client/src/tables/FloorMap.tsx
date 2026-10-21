import React, { useRef, useState } from 'react';
import { time } from '../shared/format';
import { STORE } from '../shared/store';
import type { DiningTable } from '../shared/types';
import { CHAIR, chairsFor, minutesSince, tableLabel } from './tables';

// The dining room as drawn by the owner. Tap a table to pick it; in admin, drag tables to move them.
export function FloorMap({ tables, selectedId, onPick, onMove }: { tables: DiningTable[]; selectedId?: number | null; onPick: (t: DiningTable) => void; onMove?: (t: DiningTable, x: number, y: number) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const point = (e: React.PointerEvent) => { const p = svg.current!.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.current!.getScreenCTM()!.inverse()); };
  return <div className="floor-map"><svg ref={svg} viewBox="0 70 1280 640" role="group" aria-label="Floor map"
    onPointerMove={e => { if (!drag) return; const p = point(e); setDrag({ ...drag, x: Math.max(0, Math.min(1240, p.x - drag.dx)), y: Math.max(70, Math.min(690, p.y - drag.dy)), moved: true }); }}
    onPointerUp={() => { if (!drag) return; const t = tables.find(x => x.id === drag.id); if (t && drag.moved) onMove?.(t, drag.x, drag.y); else if (t) onPick(t); setDrag(null); }}>
    {STORE === 'ambiente' && <g className="fm-decor" aria-hidden="true">
      <rect x="100" y="95" width="165" height="355" rx="6" /><text x="182" y="122">Balcony</text>
      <path className="fm-cashier" d="M300 345 H500 L505 310 H670 V705 H300 Z" /><text x="545" y="380">Cashier</text>
      <line className="fm-entrance" x1="540" y1="80" x2="700" y2="80" /><text x="620" y="104">Entrance</text>
      <rect x="720" y="95" width="160" height="24" rx="12" /><rect x="895" y="90" width="22" height="95" rx="4" />
    </g>}
    {tables.map(t => { const x = drag?.id === t.id ? drag.x : t.x, y = drag?.id === t.id ? drag.y : t.y, size = Math.min(20, t.w / Math.max(2, tableLabel(t.name).length) * 1.5);
      return <g key={t.id} className={`fm-table ${t.party ? 'busy' : ''} ${selectedId === t.id ? 'selected' : ''} ${onMove ? 'movable' : ''}`} role="button" tabIndex={0} aria-label={`${t.name}, ${t.seats} seats, ${t.party ? `occupied ${minutesSince(t.party.seated_at)} min` : 'free'}`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(t); } }}
        onPointerDown={e => { if (onMove) { const p = point(e); (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); setDrag({ id: t.id, dx: p.x - t.x, dy: p.y - t.y, x: t.x, y: t.y, moved: false }); } }}
        onClick={() => { if (!onMove) onPick(t); }}>
        <title>{t.name} · {t.seats} seats{t.party ? ` · seated ${time(t.party.seated_at)}` : ''}</title>
        <rect className="fm-hit" x={x - 26} y={y - 26} width={t.w + 52} height={t.h + 52} />
        {chairsFor(t, x, y).map((c, i) => <rect key={i} className="fm-chair" x={c.x} y={c.y} width={CHAIR} height={CHAIR} rx="3" />)}
        <rect className="fm-top" x={x} y={y} width={t.w} height={t.h} rx="5" />
        <text x={x + t.w / 2} y={y + t.h / 2} fontSize={size}>{tableLabel(t.name)}</text>
      </g>; })}
  </svg><div className="fm-key"><span className="fm-swatch" /> Free <span className="fm-swatch busy" /> Occupied <span className="fm-swatch selected" /> Selected</div></div>;
}
