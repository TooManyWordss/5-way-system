import { screenPath, storageKey, storeUrl } from './store';
import type { Role } from './types';

export async function api<T = any>(url: string, options: { method?: string; body?: unknown; form?: FormData; redirectOnUnauthorized?: boolean } = {}): Promise<T> {
  const headers: HeadersInit = options.form ? {} : options.body ? { 'Content-Type': 'application/json' } : {};
  const response = await fetch(storeUrl(url), { method: options.method ?? 'GET', credentials: 'same-origin', headers, body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined) });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    if (options.redirectOnUnauthorized !== false) { clearCachedSessions(); location.href = storeUrl(`/login?role=${roleFromPath()}`); }
    throw Object.assign(new Error(payload.error ?? 'Please log in'), { status: 401 });
  }
  if (!response.ok) throw Object.assign(new Error(payload.error ?? `Request failed (${response.status})`), { status: response.status });
  return payload as T;
}
export function roleFromPath(): Role { const p = screenPath().slice(1); return (['pos', 'barista', 'kitchen', 'inventory', 'admin'].includes(p) ? p : 'admin') as Role; }
export function clearCachedSessions() { for (const role of ['pos', 'barista', 'kitchen', 'inventory', 'admin']) localStorage.removeItem(storageKey(`session.${role}`)); }
export async function logout() { await fetch(storeUrl('/api/logout'), { method: 'POST', credentials: 'same-origin' }).catch(() => {}); clearCachedSessions(); location.href = storeUrl(`/login?role=${roleFromPath()}`); }
