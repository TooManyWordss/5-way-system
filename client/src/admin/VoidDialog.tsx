import { FormEvent } from 'react';
import { api } from '../shared/api';
import { money } from '../shared/format';
import type { Order } from '../shared/types';
import { Dialog } from '../shared/ui';

export function VoidDialog({order,onClose,onSaved,notify}:{order:Order;onClose:()=>void;onSaved:()=>void;notify:(m:string)=>void}){
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason')??'').trim();if(!reason)return;try{await api(`/api/orders/${order.id}/void`,{method:'POST',body:{reason}});notify(`Receipt #${order.receipt_label??order.receipt_no} voided · ${money(order.total_cents)}`);onSaved();onClose();}catch(err){notify((err as Error).message);}}
  return <Dialog title={`Void receipt #${order.receipt_label??order.receipt_no}`} onClose={onClose}><form onSubmit={submit}><p className="hint">{money(order.total_cents)} · Stays on record but no longer counts as a sale. Stock it used is put back.</p><label>Reason<input name="reason" required maxLength={200} autoFocus/></label><div className="sheet-actions"><button type="button" className="btn ghost" onClick={onClose}>Keep receipt</button><button className="btn danger">Void receipt</button></div></form></Dialog>;
}
