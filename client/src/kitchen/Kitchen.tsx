import { DiningKitchen } from '../dining';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { time } from '../shared/format';
import { useLive, useSession } from '../shared/hooks';
import { STORE, STORE_NAME } from '../shared/store';
import type { Line, Order } from '../shared/types';
import { Logo, TopBar } from '../shared/ui';

// "12 min", "1 h 20 min", "2 d": short enough to stay on one line of the ticket.
const waited = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${Math.floor(minutes / 1440)} d`;

const itemState = (i: Line) => i.kitchen_ready_at ? 'ready' : i.kitchen_started_at ? 'cooking' : 'waiting';
const ITEM_LABEL = { waiting: 'Waiting · tap to start', cooking: 'Cooking · tap when ready', ready: 'Ready' } as const;

export function Kitchen() {
  const {user,ready}=useSession('kitchen'),[tickets,setTickets]=useState<Order[]>([]),[started,setStarted]=useState(false),[offline,setOffline]=useState(false),[now,setNow]=useState(Date.now());
  const load=useCallback(()=>api<Order[]>('/api/kitchen/tickets').then(setTickets).catch(()=>{}),[]);
  const event=useCallback((name:string,o:any)=>{const put=(v:Order[])=>[...v.filter(x=>x.id!==o.id),o].sort((a,b)=>a.id-b.id);if(name==='order.created'&&o.kitchen_status!=='none'){setTickets(put);if(started)chime();}if(name==='order.updated'||name==='ticket.updated'){setTickets(v=>o.status==='voided'||!['new','preparing'].includes(o.kitchen_status)?v.filter(x=>x.id!==o.id):put(v));if(name==='order.updated'&&started)chime();}},[started]);
  const state=useLive(event);useEffect(()=>{void load();const id=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(id);},[load]);
  function chime(){try{const Ctx=window.AudioContext;const c=new Ctx();[880,1175].forEach((hz,i)=>{const o=c.createOscillator(),g=c.createGain();o.frequency.value=hz;g.gain.setValueAtTime(.0001,c.currentTime+i*.18);g.gain.exponentialRampToValueAtTime(.25,c.currentTime+i*.18+.02);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+i*.18+.35);o.connect(g).connect(c.destination);o.start(c.currentTime+i*.18);o.stop(c.currentTime+i*.18+.4);});}catch{}}
  async function begin(){setStarted(true);chime();try{await document.documentElement.requestFullscreen?.();}catch{}try{await navigator.wakeLock?.request('screen');}catch{}}
  async function update(o:Order,next:string){try{await api(`/api/orders/${o.id}/kitchen`,{method:'PATCH',body:{status:next}});await load();}catch(e){alert((e as Error).message);}}
  // Each tap moves an item along: waiting → cooking → ready → (tapped by mistake) waiting.
  async function stepItem(o:Order,i:Line){const now=itemState(i),next=now==='waiting'?'cooking':now==='cooking'?'ready':'waiting';try{await api(`/api/orders/${o.id}/items/${i.id}/kitchen`,{method:'PATCH',body:{state:next}});await load();}catch(e){alert((e as Error).message);}}
  if(!ready)return <div className="loading">Opening kitchen…</div>;
  return <div className="kitchen-page"><TopBar title={STORE_NAME} subtitle={`Kitchen · ${tickets.length} open`} state={state} user={user}/>{state==='Offline'&&<div className="offline-banner">Connection lost — new orders will not appear until it’s back</div>}{STORE==='ambiente'&&<DiningKitchen role="kitchen" started={started} chime={chime} includeCounter={false}/>}<main className="tickets">{tickets.filter(o=>['new','preparing'].includes(o.kitchen_status)).map(o=>{const age=Math.max(0,Math.floor((now-new Date(o.created_at).getTime())/60000)), next=o.kitchen_status==='new'?'preparing':'ready',kitchenItems=o.items.filter(i=>i.sends_to_kitchen!==0),readyCount=kitchenItems.filter(i=>i.kitchen_ready_at).length,cookingCount=kitchenItems.filter(i=>itemState(i)==='cooking').length;return <article className={`ticket ${o.kitchen_status} ${age>=10?'late':''}`} key={o.id}><div className="ticket-head"><h2>#{o.receipt_label??o.receipt_no} <span className="ticket-table">{o.table_name??'Takeout'}</span></h2><span className="ticket-age">{waited(age)} · {time(o.created_at)}</span></div><div className="ticket-state">{o.kitchen_status==='new'?'New':'Preparing'}{cookingCount>0&&` · ${cookingCount} cooking`}{readyCount>0&&` · ${readyCount} of ${kitchenItems.length} ready`} {o.edit_count>0&&<span className="pill">Edited</span>}</div><ul>{kitchenItems.map((i,n)=>{const st=itemState(i);return <li key={i.id??n}><button type="button" className={`ticket-item ${st}`} aria-label={`${i.qty} ${i.name}: ${ITEM_LABEL[st]}`} disabled={!i.id} onClick={()=>void stepItem(o,i)}><span className="tick" aria-hidden="true">{st==='ready'?'✓':st==='cooking'?'🔥':''}</span><span className="ti-body"><span><b className="q">{i.qty}×</b><span className="ti-name">{i.name}</span></span><small className="ti-state">{ITEM_LABEL[st]}</small></span></button></li>;})}</ul><button className={`btn ${next==='ready'?'primary':''}`} onClick={()=>void update(o,next)}>{next==='ready'?'All done':'Start all'}</button></article>})}{tickets.length===0&&<div className="kitchen-empty"><Logo large/><p>No open tickets</p></div>}</main>{!started&&<button className="start-overlay" onClick={()=>void begin()}><Logo large/><strong>Tap to start kitchen display</strong><span>Turns on the new-order chime and keeps the screen awake</span></button>}</div>;
}
