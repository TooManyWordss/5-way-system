import { FormEvent, useState } from 'react';
import { api } from '../shared/api';
import { Dialog } from '../shared/ui';

// Owner: change the owner password for this store. Needs the current password.
export function OwnerPassword({ notify }: { notify: (message: string) => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget), password = String(f.get('password') ?? '');
    if (password !== f.get('confirm')) { setError('New passwords do not match'); return; }
    setError(''); setSaving(true);
    try { await api('/api/admin/password', { method: 'POST', body: { current: f.get('current'), password } }); notify('Owner password changed'); setOpen(false); }
    catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }
  return <>
    <button className="btn" onClick={() => { setError(''); setOpen(true); }}>Change owner password</button>
    {open && <Dialog title="Change owner password" onClose={() => setOpen(false)}><form onSubmit={save}>
      <label>Current password<input name="current" type="password" autoComplete="current-password" required autoFocus /></label>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
      <p className="hint">At least 10 characters. It opens every screen of this store, so keep it to yourself.</p>
      {error && <p className="status error" role="alert">{error}</p>}
      <div className="sheet-actions"><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button></div>
    </form></Dialog>}
  </>;
}
