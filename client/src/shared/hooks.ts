import { useCallback, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { clearCachedSessions, roleFromPath } from './api';
import { storageKey, STORE, storeUrl } from './store';
import type { Role, User } from './types';

export function useSession(role: Role) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => {
      setReady(false);
      try {
        const response = await fetch(storeUrl(`/api/me?role=${role}`), { credentials: 'same-origin', cache: 'no-store' });
        if (response.status === 401) {
          clearCachedSessions();
          location.replace(storeUrl(`/login?role=${role}`));
          return;
        }
        if (!response.ok) throw new Error('Could not check session');
        const current = await response.json() as User;
        if (!active) return;
        setUser(current);
        localStorage.setItem(storageKey(`session.${role}`), JSON.stringify(current));
      } catch {
        if (!active) return;
        const cached = localStorage.getItem(storageKey(`session.${role}`));
        if (cached) setUser(JSON.parse(cached));
        else { location.replace(storeUrl(`/login?role=${role}`)); return; }
      }
      if (active) { document.documentElement.classList.remove('session-checking'); setReady(true); }
    };
    const onPageHide = () => document.documentElement.classList.add('session-checking');
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    void check();
    return () => { active = false; window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow); };
  }, [role]);
  return { user, ready };
}
export function useLive(onEvent?: (event: string, data: any) => void) {
  const [state, setState] = useState<'Connecting' | 'Live' | 'Offline'>('Connecting');
  useEffect(() => {
    const socket: Socket = io({ withCredentials: true, auth: { store: STORE } });
    socket.on('connect', () => setState('Live'));
    socket.on('disconnect', () => setState('Offline'));
    socket.on('connect_error', (e) => { setState('Offline'); if (e.message === 'unauthorized') { clearCachedSessions(); location.href = storeUrl(`/login?role=${roleFromPath()}`); } });
    const events = ['order.created','order.updated','ticket.updated','menu.requested','menu.updated','inventory.updated','inventory.low','security.updated','stores.updated','tables.updated','dining.updated','screens.updated'];
    events.forEach((event) => socket.on(event, (data) => { if(['dining.updated','tables.updated','order.created','order.updated','ticket.updated'].includes(event)) window.dispatchEvent(new Event('dining.live')); onEvent?.(event, data); }));
    return () => { socket.disconnect(); };
  }, [onEvent]);
  return state;
}
export function useToast() {
  const [toast, setToast] = useState('');
  const notify = useCallback((value: string) => { setToast(value); window.setTimeout(() => setToast(''), 4500); }, []);
  return { toast, notify };
}
