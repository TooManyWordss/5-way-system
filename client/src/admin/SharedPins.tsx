import { FormEvent, useEffect, useState } from 'react';

type PinRole = 'pos' | 'barista' | 'kitchen' | 'inventory';
type Props = {
  security: { pin?: Record<PinRole, boolean>; pinSet?: Record<PinRole, boolean> } | null;
  refresh: () => void;
  notify: (message: string) => void;
  request: (url: string, options: { method: string; body: unknown }) => Promise<unknown>;
};
const roles: PinRole[] = ['pos', 'barista', 'kitchen', 'inventory'];
const labels: Record<PinRole, string> = { pos: 'POS', barista: 'Barista', kitchen: 'Kitchen', inventory: 'Inventory' };

export default function SharedPins({ security, refresh, notify, request }: Props) {
  const [editing, setEditing] = useState<PinRole | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditing(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  async function toggle(role: PinRole, allowed: boolean) {
    try { await request('/api/admin/sign-in-settings', { method: 'POST', body: { [role]: allowed } }); refresh(); }
    catch (e) { notify((e as Error).message); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const pin = String(form.get('pin') ?? '');
    if (pin !== form.get('confirm')) { setError('PINs do not match'); return; }
    setError(''); setSaving(true);
    try {
      await request(`/api/admin/pins/${editing}`, { method: 'POST', body: { pin } });
      notify(`${labels[editing]} PIN saved`);
      setEditing(null);
      refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return <>
    <h3>Shared PINs</h3>
    <p className="hint">Set a PIN for each screen here. Changes are saved for this store and take effect at the next sign-in.</p>
    <div className="shared-pins">{roles.map(role => <div className="shared-pin-row" key={role}>
      <label className="toggle"><input type="checkbox" checked={Boolean(security?.pin?.[role])} disabled={!security?.pinSet?.[role]} onChange={event => void toggle(role, event.target.checked)} /> Allow shared {role} PIN</label>
      <button className="btn small" onClick={() => { setError(''); setEditing(role); }}>{security?.pinSet?.[role] ? 'Change PIN' : 'Set PIN'}</button>
    </div>)}</div>
    {editing && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><section className="sheet" role="dialog" aria-modal="true" aria-label={`${labels[editing]} PIN`}>
      <h2>{security?.pinSet?.[editing] ? 'Change' : 'Set'} {labels[editing]} PIN</h2>
      <form onSubmit={save}>
        <label>New PIN<input name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,12}" minLength={4} maxLength={12} required autoFocus /></label>
        <label>Confirm PIN<input name="confirm" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,12}" minLength={4} maxLength={12} required /></label>
        <p className="hint">Use 4 to 12 digits. The old PIN stops working for new sign-ins.</p>
        {error && <p className="status error" role="alert">{error}</p>}
        <div className="sheet-actions"><button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={saving}>Save PIN</button></div>
      </form>
    </section></div>}
  </>;
}
