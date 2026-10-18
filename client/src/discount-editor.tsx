import React from 'react';

export default function DiscountEditor({ discount, onSave, onClose, busy = false }: { discount: any; onSave: (discount: any) => void; onClose: () => void; busy?: boolean }) {
  return <form className="dining-form" onSubmit={e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    onSave({ kind: f.get('kind'), value: Math.round(Number(f.get('amount')) * 100), label: f.get('label'), reason: f.get('reason') });
  }}>
    <p>PWD and senior labels identify a manual discount; staff enter the amount.</p>
    <label>Type<select name="kind" defaultValue={discount?.kind ?? 'percent'}><option value="percent">Percentage</option><option value="fixed">Fixed pesos</option></select></label>
    <label>Amount / percent<input name="amount" type="number" min="0" step="0.01" defaultValue={(discount?.value ?? 0) / 100} required/></label>
    <label>Label<select name="label" defaultValue={discount?.label ?? ''}><option value="">General</option><option>PWD</option><option>Senior</option></select></label>
    <label>Reason<input name="reason" maxLength={200} defaultValue={discount?.reason ?? ''} required/></label>
    <div className="dining-actions"><button className="btn primary" disabled={busy}>Apply discount</button><button type="button" className="btn" disabled={busy} onClick={() => onSave(null)}>Remove discount</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
  </form>;
}
