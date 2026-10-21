import { useState } from 'react';
import { api } from '../shared/api';
import { money, time } from '../shared/format';
import type { MenuItem, Order } from '../shared/types';
import { Dialog } from '../shared/ui';

// Owner: change any receipt's items. Items already on it keep their sold price; added ones use today's price.
export function ReceiptEditor({order,menu,onClose,onSaved,notify}:{order:Order;menu:MenuItem[];onClose:()=>void;onSaved:()=>void;notify:(m:string)=>void}){
  const [qty,setQty]=useState<Record<number,number>>(()=>{const q:Record<number,number>={};for(const i of order.items)q[i.menu_item_id]=(q[i.menu_item_id]??0)+i.qty;return q;}),[adding,setAdding]=useState(''),[saving,setSaving]=useState(false);
  const priceOf=(id:number)=>order.items.find(i=>i.menu_item_id===id)?.unit_price_cents??menu.find(m=>m.id===id)?.price_cents??0;
  const nameOf=(id:number)=>order.items.find(i=>i.menu_item_id===id)?.name??menu.find(m=>m.id===id)?.name??`Item ${id}`;
  const lines=Object.entries(qty).map(([id,n])=>({id:Number(id),qty:n})).filter(l=>l.qty>0);
  const subtotal=lines.reduce((n,l)=>n+priceOf(l.id)*l.qty,0),oldSubtotal=order.subtotal_cents??order.total_cents;
  const change=(id:number,d:number)=>setQty(q=>({...q,[id]:Math.max(0,Math.min(99,(q[id]??0)+d))}));
  async function save(){if(!lines.length)return notify('A receipt needs at least one item. Void it instead.');setSaving(true);try{const r=await api<any>(`/api/orders/${order.id}`,{method:'PATCH',body:{expectedVersion:order.version,items:lines.map(l=>({menuItemId:l.id,qty:l.qty}))}});notify(r.differenceCents>0?`Receipt updated · collect ${money(r.differenceCents)}`:r.differenceCents<0?`Receipt updated · give back ${money(-r.differenceCents)}`:'Receipt updated · total unchanged');onSaved();onClose();}catch(e){notify((e as Error).message);}finally{setSaving(false);}}
  return <Dialog title={`Edit receipt #${order.receipt_label??order.receipt_no}`} onClose={onClose}><p className="hint">Was {money(order.total_cents)} · {time(order.created_at)}. Stock used by the menu items is adjusted to match.</p>
    <ul className="line-editor">{lines.map(l=><li key={l.id}><span>{nameOf(l.id)}</span><span className="qty"><button type="button" aria-label={`One less ${nameOf(l.id)}`} onClick={()=>change(l.id,-1)}>−</button><span>{l.qty}</span><button type="button" aria-label={`One more ${nameOf(l.id)}`} onClick={()=>change(l.id,1)}>+</button></span><span className="num">{money(priceOf(l.id)*l.qty)}</span></li>)}{!lines.length&&<li className="hint">No items left. Add one, or close and void the receipt.</li>}</ul>
    <div className="add-row"><select aria-label="Add a menu item" value={adding} onChange={e=>setAdding(e.target.value)}><option value="">Add an item…</option>{menu.filter(m=>m.available).map(m=><option key={m.id} value={m.id}>{m.name} · {money(m.price_cents)}</option>)}</select><button type="button" className="btn" disabled={!adding} onClick={()=>{change(Number(adding),1);setAdding('');}}>Add</button></div>
    <dl className="totals"><dt className="grand">New subtotal</dt><dd className="grand">{money(subtotal)}</dd><dt>Difference</dt><dd>{subtotal===oldSubtotal?'—':`${subtotal>oldSubtotal?'collect':'give back'} ${money(Math.abs(subtotal-oldSubtotal))}`}</dd></dl>
    <div className="sheet-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving||!lines.length} onClick={()=>void save()}>{saving?'Saving…':'Save changes'}</button></div></Dialog>;
}
