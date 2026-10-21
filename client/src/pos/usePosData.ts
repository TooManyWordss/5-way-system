import { useCallback, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { useLive } from '../shared/hooks';
import { storageKey } from '../shared/store';
import type { DiningTable, MenuItem } from '../shared/types';

export function usePosData(station: 'cashier' | 'barista') {
  const [menuData, setMenuData] = useState<{ items: MenuItem[]; pending: MenuItem[]; taxRate: number; receipt: any } | null>(null);
  const [today, setToday] = useState<any>(null);
  const loadMenu = useCallback(async () => { const data = await api<any>(`/api/menu?station=${station}`); setMenuData(data); localStorage.setItem(storageKey(`menu.${station}`), JSON.stringify(data)); }, [station]);
  const loadToday = useCallback(async () => setToday(await api(`/api/pos/today?station=${station}`)), [station]);
  const [tables, setTables] = useState<DiningTable[]>(() => JSON.parse(localStorage.getItem(storageKey('tables')) ?? '[]'));
  const loadTables = useCallback(async () => { const data = await api<DiningTable[]>('/api/tables'); setTables(data); localStorage.setItem(storageKey('tables'), JSON.stringify(data)); }, []);
  const onEvent = useCallback((event: string) => { if (event === 'menu.updated') void loadMenu(); if (event.startsWith('order.')) void loadToday(); if (event === 'tables.updated') void loadTables().catch(() => {}); }, [loadMenu, loadToday, loadTables]);
  const state = useLive(onEvent);
  useEffect(()=>{const refresh=()=>{void loadMenu().catch(()=>{});void loadToday().catch(()=>{});};window.addEventListener('dining.business',refresh);return()=>window.removeEventListener('dining.business',refresh);},[loadMenu,loadToday]);
  useEffect(() => { void loadMenu().catch(() => { const saved = localStorage.getItem(storageKey(`menu.${station}`)); if (saved) setMenuData(JSON.parse(saved)); }); void loadToday().catch(() => {}); void loadTables().catch(() => {}); }, [loadMenu, loadToday, loadTables, station]);
  return { menuData, today, loadMenu, loadToday, tables, loadTables, state };
}
