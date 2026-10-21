import { useEffect, useState, FormEvent } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from '../shared/api';
import { roleName } from '../shared/format';
import type { Role } from '../shared/types';
import { Logo } from '../shared/ui';

export function Login({ role }: { role: Role }) {
  const [secret, setSecret] = useState(''), [error, setError] = useState(''), [setup, setSetup] = useState(false), [code, setCode] = useState(''), [pinAllowed, setPinAllowed] = useState(true), [passkeyAvailable, setPasskeyAvailable] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { api<any>(`/api/login-options?role=${role}`).then((d) => { setPinAllowed(d.pin); setPasskeyAvailable(Boolean(window.isSecureContext && window.PublicKeyCredential && (role !== 'admin' || d.passkeys))); }).catch(() => {}); }, [role]);
  const post = <T = any,>(url: string, body: unknown) => api<T>(url, { method: 'POST', body, redirectOnUnauthorized: false });
  async function pinLogin(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { location.href = (await post('/api/login', { role, secret })).home; } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function passkeyLogin() { setBusy(true); setError(''); try { const { options, challengeId } = await post('/api/passkeys/login/options', {}); const response = await startAuthentication({ optionsJSON: options }); location.href = (await post('/api/passkeys/login', { challengeId, response, role })).home; } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function setupPasskey(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { const { options, challengeId } = await post('/api/passkeys/setup', { code }); const response = await startRegistration({ optionsJSON: options }); location.href = (await post('/api/passkeys/register', { challengeId, response, device: navigator.userAgent.includes('iPad') ? 'iPad' : 'Device' })).home; } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <main className="login"><section className="login-card"><Logo large /><h1>{roleName[role]}</h1>
    {passkeyAvailable && !setup && <div className="passkey-area"><button className="btn primary bio-btn" onClick={passkeyLogin} disabled={busy}>◉　Sign in with Face ID / fingerprint</button><button className="link" onClick={() => setSetup(true)}>First time on this device? Set it up</button></div>}
    {setup && <form className="setup-form" onSubmit={setupPasskey}><label>Setup code from the owner<input inputMode="numeric" autoComplete="one-time-code" maxLength={9} placeholder="8 digits" value={code} onChange={e => setCode(e.target.value)} /></label><button className="btn primary" disabled={busy}>Set up Face ID / fingerprint</button><button type="button" className="link" onClick={() => setSetup(false)}>Back</button></form>}
    {passkeyAvailable && pinAllowed && <p className="or"><span>or</span></p>}
    {pinAllowed && !setup && <form className="pin-form" onSubmit={pinLogin}><label>{role === 'admin' ? 'Password' : 'PIN'}<input autoFocus type="password" inputMode={role === 'admin' ? 'text' : 'numeric'} autoComplete="current-password" required value={secret} onChange={e => setSecret(e.target.value)} /></label><button className={`btn ${passkeyAvailable ? '' : 'primary'}`} disabled={busy}>Open</button></form>}
    <p className="status error" role="alert">{error}</p>{!window.isSecureContext && <p className="hint">Face ID and fingerprint sign-in only work on the secure HTTPS address or localhost.</p>}
  </section></main>;
}
