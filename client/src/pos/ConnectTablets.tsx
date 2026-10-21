import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api } from '../shared/api';
import { BASE } from '../shared/store';
import { Dialog } from '../shared/ui';

// A QR code the kitchen (or barista) tablet scans with its camera to open its screen on this system.
// On the café tablet the POS runs at localhost, which other tablets can't use, so the server says
// which address the café Wi-Fi knows it by.
function QrCode({ text }: { text: string }) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  return <div className="qr" role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true }) }} />;
}

export function ConnectTablets({ onClose }: { onClose: () => void }) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const [base, setBase] = useState<string | null>(local ? null : location.origin + BASE), [screen, setScreen] = useState<'kitchen' | 'barista' | 'admin'>('kitchen');
  useEffect(() => { if (local) void api<{ lanUrl: string | null }>('/api/connect-info').then(d => setBase(d.lanUrl ? d.lanUrl + BASE : '')).catch(() => setBase('')); }, [local]);
  const url = base ? `${base}/${screen}` : '';
  return <Dialog title="Connect another tablet" onClose={onClose}>
    <div className="perf-units" role="tablist">{([['kitchen', 'Kitchen'], ['barista', 'Barista'], ['admin', 'Owner']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={screen === k} className={`chip ${screen === k ? 'active' : ''}`} onClick={() => setScreen(k)}>{l}</button>)}</div>
    {base === null ? <p className="hint">Finding this tablet's address…</p> : url ? <>
      <QrCode text={url} />
      <ol className="connect-steps"><li>Connect the other tablet to the <strong>same Wi‑Fi</strong> as this one.</li><li>Open its <strong>camera</strong> and point it at the code, then tap the link.</li><li>Sign in with the screen's PIN.</li></ol>
      <p className="connect-url">{url}</p>
    </> : <p className="status warn">This tablet's Wi‑Fi address couldn't be found. Check it's connected to the café Wi‑Fi, then restart the café server (type <code>cafe</code> in Termux).</p>}
    <div className="sheet-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
  </Dialog>;
}
