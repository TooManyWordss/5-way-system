import type { Role } from './types';

export const money = (cents = 0) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
export const peso = (amount = 0) => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(amount);
export const time = (date?: string | null) => date ? new Date(date).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '—';
export const dateLabel = (date?: string) => date ? new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
export const rid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const roleName: Record<Role, string> = { pos: 'POS', barista: 'Barista', kitchen: 'Kitchen display', inventory: 'Inventory', admin: 'Admin panel' };
export function localDay(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function todayDate(){return localDay();}
export function shiftDate(date:string,days:number){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);}
