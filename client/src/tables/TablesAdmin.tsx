import { useState, FormEvent } from 'react';
import { api } from '../shared/api';
import type { DiningTable } from '../shared/types';
import { FloorMap } from './FloorMap';

// Owner: drag tables into place on the map, rename them, change seats, add or remove.
export function TablesAdmin({tables,refresh,notify}:{tables:DiningTable[];refresh:()=>void;notify:(m:string)=>void}){
  const [selected,setSelected]=useState<number|null>(null);const t=tables.find(x=>x.id===selected);
  const patch=async(id:number,body:any)=>{try{await api(`/api/admin/tables/${id}`,{method:'PATCH',body});refresh();}catch(e){notify((e as Error).message);}};
  async function add(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,f=new FormData(form);try{const created=await api<DiningTable>('/api/admin/tables',{method:'POST',body:{name:f.get('name'),seats:Number(f.get('seats'))}});form.reset();setSelected(created.id);notify(`${created.name} added at the bottom left of the map. Drag it into place.`);refresh();}catch(err){notify((err as Error).message);}}
  return <section className="panel"><h2>Tables <span className="pill">{tables.filter(x=>x.party).length} of {tables.length} occupied</span></h2><p className="hint">Drag a table to move it; it snaps into line with the others. Tap one to rename it or change its seats.</p>
    <FloorMap tables={tables} selectedId={selected} onPick={x=>setSelected(x.id)} onMove={(x,nx,ny)=>void patch(x.id,{x:nx,y:ny})}/>
    {t&&<form className="staff-form" key={t.id} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void patch(t.id,{name:f.get('name'),seats:Number(f.get('seats'))});}}><input name="name" defaultValue={t.name} aria-label="Table name" maxLength={30}/><input name="seats" type="number" min={1} max={50} defaultValue={t.seats} aria-label="Seats"/><span className="edit-buttons"><button className="btn primary">Save</button><button type="button" className="btn danger-outline" onClick={async()=>{if(!confirm(`Remove ${t.name}?`))return;try{await api(`/api/admin/tables/${t.id}`,{method:'DELETE'});setSelected(null);refresh();}catch(err){notify((err as Error).message);}}}>Remove</button></span></form>}
    <form className="staff-form" onSubmit={add}><input name="name" required maxLength={30} placeholder="New table name"/><input name="seats" type="number" min={1} max={50} defaultValue={4} aria-label="Seats"/><button className="btn">Add table</button></form>
  </section>;
}
