export const STORE = location.pathname === '/rairock' || location.pathname.startsWith('/rairock/') ? 'rairock' : 'ambiente';
export const BASE = STORE === 'rairock' ? '/rairock' : '';
export const STORE_NAME = STORE === 'rairock' ? 'RaiRock Seafoods' : 'Café Ambiente';
export const storeUrl = (path: string) => `${BASE}${path}`;
export const screenPath = () => location.pathname.slice(BASE.length) || '/';
export function storageKey(key: string) {
  const scoped = `5way.${STORE}.${key}`;
  if (STORE === 'ambiente' && localStorage.getItem(scoped) === null) {
    const old = localStorage.getItem(`5way.${key}`);
    if (old !== null) { localStorage.setItem(scoped, old); localStorage.removeItem(`5way.${key}`); }
  }
  return scoped;
}
document.documentElement.dataset.store = STORE;
