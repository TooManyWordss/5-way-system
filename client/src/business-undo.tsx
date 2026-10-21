import React, { useEffect, useRef, useState } from 'react';
import { diningRequest } from './dining-store';

// Complements domain-specific draft undo with field undo on the existing forms.
export default function BusinessUndo() {
  const [saved, setSaved] = useState<string | null>(null), [message, setMessage] = useState(''), [count, setCount] = useState(0), [busy, setBusy] = useState(false);
  const edits = useRef<{ element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; value: string | boolean }[]>([]);
  useEffect(() => {
    const values = new WeakMap<Element, string | boolean>(); let restoring = false;
    const value = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    const eligible = (e: Event) => {
      const el = e.target;
      return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && !(el instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(el.type)) && !el.closest('.login-page,.security') ? el : null;
    };
    const focus = (e: Event) => { const el = eligible(e); if (el) values.set(el, value(el)); };
    const input = (e: Event) => {
      const el = eligible(e); if (!el || restoring) return;
      const old = values.get(el), next = value(el);
      if (old !== undefined && old !== next) { edits.current.push({ element: el, value: old }); if (edits.current.length > 100) edits.current.shift(); setCount(edits.current.length); }
      values.set(el, next);
    };
    const undo = () => {
      let entry = edits.current.pop();
      while (entry && !entry.element.isConnected) entry = edits.current.pop();
      if (entry) {
        const { element, value } = entry;
        restoring = true;
        const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(proto, typeof value === 'boolean' ? 'checked' : 'value')?.set?.call(element, value);
        element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
        values.set(element, value); restoring = false;
      }
      setCount(edits.current.length);
    };
    const mutation = (event: Event) => { setSaved((event as CustomEvent<string>).detail); setMessage(''); };
    const clear = () => { edits.current = []; setCount(0); };
    document.addEventListener('focusin', focus); document.addEventListener('input', input, true); document.addEventListener('change', input, true); document.addEventListener('submit', clear);
    window.addEventListener('dining.undo-field', undo); window.addEventListener('dining.saved', mutation);
    return () => { document.removeEventListener('focusin', focus); document.removeEventListener('input', input, true); document.removeEventListener('change', input, true); document.removeEventListener('submit', clear); window.removeEventListener('dining.undo-field', undo); window.removeEventListener('dining.saved', mutation); };
  }, []);
  if (location.pathname.startsWith('/rairock') || location.pathname.includes('login') || !['/pos', '/barista', '/inventory', '/kitchen', '/admin'].includes(location.pathname)) return null;
  const undoSaved = async () => {
    if (!saved) return;
    setBusy(true);
    try {
      const result = await diningRequest(`/business-undo/${saved}`, {});
      const amount = Math.abs(result.cash_correction_cents ?? 0) / 100;
      setMessage(amount ? `${result.cash_correction_cents < 0 ? 'Return' : 'Collect'} ₱${amount.toFixed(2)} ${result.cash_correction_cents < 0 ? 'to' : 'from'} the customer.` : 'Action reversed.'); setSaved(null);
      window.dispatchEvent(new Event('dining.business')); window.dispatchEvent(new Event('dining.live'));
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  return count || saved || message ? <aside className="dining-global-undo">{count > 0 && <button className="btn small" onClick={() => window.dispatchEvent(new Event('dining.undo-field'))}>Undo field change</button>} {saved && <button className="btn small" disabled={busy} onClick={() => void undoSaved()}>Undo saved action</button>} {message && <><span role="status">{message}</span> <button className="btn small" aria-label="Dismiss undo message" onClick={() => setMessage('')}>×</button></>}</aside> : null;
}
