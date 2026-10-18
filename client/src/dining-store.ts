import { applyDining, emptyDining, type DiningOperation, type DiningState } from '../../dining-domain.js';

export type Snapshot = DiningState & { revision?: number; menu: any[]; taxRate: number; receipt?: { name: string; header: string[]; footer: string[] }; serverTime?: string };
export type Queued = { operation: DiningOperation; role: string; status: 'pending' | 'conflict'; error?: string };
export type Cache = { base: Snapshot; queue: Queued[]; drafts: Record<string, any>; receipts: Record<string, any> };
export const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const key = 'ambiente-table-service-v1';
const initial = (): Cache => ({ base: { ...emptyDining(), menu: [], taxRate: 0 }, queue: [], drafts: {}, receipts: {} });
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('five-way-ambiente-dining', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cache');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(key) : null;
channel?.addEventListener('message', () => window.dispatchEvent(new Event('dining.cache')));
function announce() { window.dispatchEvent(new Event('dining.cache')); channel?.postMessage('changed'); }
export async function readCache(): Promise<Cache> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('cache').objectStore('cache').get(key);
    request.onsuccess = () => resolve(request.result ?? initial());
    request.onerror = () => reject(request.error);
  });
}
// Read + modify + write in one IndexedDB transaction, including across browser tabs.
export async function updateCache(change: (cache: Cache) => void) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite'), store = tx.objectStore('cache'), request = store.get(key);
    let error: unknown;
    request.onsuccess = () => {
      try { const cache = request.result ?? initial(); change(cache); store.put(cache, key); }
      catch (e) { error = e; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(error ?? tx.error ?? new Error('Could not save offline data'));
  });
  announce();
}
export function projected(cache: Cache, role: string): Snapshot {
  let state: DiningState = cache.base;
  for (const entry of cache.queue) {
    try { state = applyDining(state, entry.operation, { role: entry.role ?? role, menu: cache.base.menu, taxRate: cache.base.taxRate }); }
    catch { /* Retain conflicting operations verbatim in the visible outbox. */ }
  }
  return { ...cache.base, ...state };
}
let deviceId = localStorage.getItem('5way.ambiente.dining.device');
if (!deviceId) { deviceId = uid(); localStorage.setItem('5way.ambiente.dining.device', deviceId); }
export async function enqueue(role: string, type: string, targetId: string, payload: any, expectedVersion?: number) {
  let operation!: DiningOperation;
  await updateCache(cache => {
    const state = projected(cache, role);
    const record = type === 'counter.kitchen' ? state.counterOrders[targetId] : type.startsWith('table.') ? state.tables[targetId] : state.visits[targetId];
    operation = { id: uid(), deviceId: deviceId!, at: new Date().toISOString(), type, targetId, expectedVersion: expectedVersion ?? record?.version ?? 0, payload };
    const previous = cache.queue.at(-1);
    if (previous) operation.dependsOn = previous.operation.id;
    applyDining(state, operation, { role, menu: state.menu, taxRate: state.taxRate });
    cache.queue.push({ operation, role, status: 'pending' });
  });
  return operation;
}
export async function diningRequest(url: string, body?: unknown, method?: string) {
  const response = await fetch(`/api/dining${url}`, { method: method ?? (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { status: response.status });
  return data;
}
let syncing: Promise<void> | undefined;
export function synchronize(role: string): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    const cache = await readCache();
    const queue = cache.queue.filter(q => q.role === role);
    const allResults: any[] = [];
    for (let offset = 0; offset < queue.length; offset += 100) {
      const batch = queue.slice(offset, offset + 100);
      const { results } = await diningRequest('/sync', { operations: batch.map(e => e.operation) });
      allResults.push(...results);
    }
    const base = await diningRequest('/state');
    await updateCache(current => {
        // A slower tab must not overwrite a newer acknowledged snapshot.
        if ((base.revision ?? 0) >= (current.base.revision ?? 0)) current.base = base;
        for (const result of allResults) {
          const queued = current.queue.find(q => q.operation.id === result.id);
          if (!queued) continue;
          if (result.status === 'applied') {
            if (result.result?.receipt) current.receipts[result.operation.targetId] = result.result.receipt;
            current.queue = current.queue.filter(q => q.operation.id !== result.id);
          } else if (result.status === 'dismissed') current.queue = current.queue.filter(q => q.operation.id !== result.id);
          else { queued.status = 'conflict'; queued.error = result.error; }
        }
    });
  })().finally(() => { syncing = undefined; });
  return syncing;
}
