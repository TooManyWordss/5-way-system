import React, { useEffect, useRef, useState } from 'react';
import { logout } from './api';
import { STORE_NAME } from './store';
import type { User } from './types';

export function Toast({ text }: { text: string }) { return text ? <div className="toast" role="status">{text}</div> : null; }
export function Logo({ large = false, mark = false }: { large?: boolean; mark?: boolean }) { return <span className={`logo${large ? ' large' : ''}${mark ? ' mark' : ''}`} aria-label={STORE_NAME} role="img" />; }
export function Connection({ state, kitchen = false }: { state: string; kitchen?: boolean }) { return <><span className={`badge ${state === 'Live' ? 'live' : state === 'Offline' ? 'offline' : ''}`}>{kitchen || state !== 'Live' ? state === 'Offline' ? 'Offline · reconnecting…' : state : ''}</span>{kitchen && state === 'Offline' && <div className="offline-banner">Connection lost — new orders will not appear until it’s back</div>}</>; }
export function TopBar({ title, subtitle, state, user, onLogout = logout, children, showLogout = true }: { title?: string; subtitle?: string; state: string; user?: User | null; onLogout?: () => void; children?: React.ReactNode; showLogout?: boolean }) {
  return <header className="topbar photo"><div className="brand"><Logo mark /><div><div className="brand-name">{title ?? STORE_NAME}</div><div className="brand-sub">{subtitle}{user?.name ? ` · ${user.name}` : ''}</div></div></div><div className="topbar-right">{children}<Connection state={state} />{showLogout&&<button className="btn ghost small" onClick={onLogout}>{user?.name ? 'Switch' : 'Log out'}</button>}</div></header>;
}
export function Metric({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) { return <div className="tile"><div className="label">{label}</div><div className="value">{value}</div>{note && <div className="delta">{note}</div>}</div>; }
export function Panel({ title, children, className = '' }: { title: React.ReactNode; children: React.ReactNode; className?: string }) { return <section className={`panel ${className}`}><h2>{title}</h2>{children}</section>; }
export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
export function Dialog({ title, children, onClose }: { title:string; children:React.ReactNode; onClose:()=>void }) { useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[onClose]);return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="sheet"><h2>{title}</h2>{children}</section></div>; }
// Actions used now and then (settings, sign-out) tucked behind one button, so the screen stays uncluttered.
export function MoreMenu({ label = 'More', items }: { label?: string; items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="more-menu" ref={box}><button type="button" className="btn small more-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label} <span aria-hidden="true">▾</span></button>
    {open && <div className="more-list" role="menu">{items.map(i => <button type="button" role="menuitem" key={i.label} className={i.danger ? 'danger' : ''} onClick={() => { setOpen(false); i.onClick(); }}>{i.label}</button>)}</div>}</div>;
}
