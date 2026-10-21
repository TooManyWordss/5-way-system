import { useEffect, useRef } from 'react';
import { money } from '../shared/format';
import type { MenuItem } from '../shared/types';

export function MenuItemCard({ item, pending = false, availabilityMode, expanded, onAvailability, onDetails, onClose, onAdd }: {
  item: MenuItem; pending?: boolean; availabilityMode: boolean; expanded: boolean; onAvailability: () => void; onDetails: () => void; onClose: () => void; onAdd: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const cancelHold = () => { window.clearTimeout(timer.current); timer.current = undefined; origin.current = null; };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!expanded) return;
    const outside = (e: PointerEvent) => { if (!card.current?.contains(e.target as Node)) onClose(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [expanded, onClose]);
  return <div ref={card} className="menu-card" data-expanded={expanded}><button type="button" className={`menu-item ${pending ? 'pending' : !item.available ? 'unavailable' : ''}`}
    aria-label={`${item.name}, ${pending ? 'awaiting approval' : money(item.price_cents)}. ${availabilityMode && !pending ? 'Change availability; hold for description' : pending || !item.available ? 'Show description' : 'Add to order and show description; hold to read only'}`}
    aria-expanded={expanded} aria-controls={`menu-description-${item.id}`}
    onPointerDown={e => {
      if (!e.isPrimary || e.button !== 0) return;
      cancelHold(); suppressClick.current = false; origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => { suppressClick.current = true; cancelHold(); onDetails(); }, 500);
    }}
    onPointerMove={e => { if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) { suppressClick.current = true; cancelHold(); } }}
    onPointerUp={cancelHold} onPointerCancel={() => { suppressClick.current = true; cancelHold(); }} onPointerLeave={cancelHold}
    onContextMenu={e => { e.preventDefault(); cancelHold(); suppressClick.current = true; onDetails(); }}
    onClick={e => {
      if (suppressClick.current && e.detail !== 0) { suppressClick.current = false; return; }
      if (availabilityMode && !pending) { onAvailability(); return; }
      onDetails();
      if (!pending && item.available) onAdd();
    }}>
    <span className="name">{item.name}</span>
    <span className="price">{pending ? 'Awaiting approval' : !item.available ? 'Unavailable' : availabilityMode ? 'Available' : money(item.price_cents)}</span>
  </button>
    {expanded && <div className="menu-card-description" id={`menu-description-${item.id}`} role="region" aria-label={`${item.name} description`} tabIndex={0}>
      <div className="menu-description-toolbar"><button type="button" className="menu-description-close" aria-label={`Close ${item.name} description`} onClick={() => { onClose(); card.current?.querySelector('button')?.focus({ preventScroll: true }); }}>Close <span aria-hidden="true">×</span></button></div>
      <p>{item.description}</p>
      {item.descriptionNote && <p className="menu-card-note">{item.descriptionNote}</p>}
    </div>}
  </div>;
}
