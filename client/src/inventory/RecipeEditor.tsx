import { useState } from 'react';
import { api } from '../shared/api';
import { peso } from '../shared/format';
import type { InventoryItem, MenuItem, Recipe } from '../shared/types';

// Owner: link menu items to stock, e.g. one Sweet Corn uses 1 pcs of Corn.
export function RecipeEditor({menu,stock,recipes,onSaved,notify}:{menu:MenuItem[];stock:InventoryItem[];recipes:Recipe[];onSaved:()=>void;notify:(m:string)=>void}){
  const [menuId,setMenuId]=useState(0),[rows,setRows]=useState<{id:number;qty:string}[]>([]),[adding,setAdding]=useState(''),[saving,setSaving]=useState(false);
  const pick=(id:number)=>{setMenuId(id);setRows(recipes.filter(r=>r.menu_item_id===id).map(r=>({id:r.inventory_item_id,qty:String(r.qty)})));};
  const linked=menu.filter(m=>recipes.some(r=>r.menu_item_id===m.id));
  const item=menu.find(m=>m.id===menuId);
  async function save(){const ingredients=rows.map(r=>({inventoryItemId:r.id,qty:Number(r.qty)}));if(ingredients.some(i=>!(i.qty>0)))return notify('Enter an amount above zero for each stock item');setSaving(true);try{await api(`/api/admin/recipes/${menuId}`,{method:'PUT',body:{ingredients}});notify(`${item?.name} saved`);onSaved();}catch(e){notify((e as Error).message);}finally{setSaving(false);}}
  return <div><h3>What each menu item uses</h3><p className="hint">Every sale takes these amounts out of stock, edits adjust them, and voids put them back. When an item drops below its reorder level you get an alert here.</p>
    <div className="recipe-pick"><select aria-label="Menu item" value={menuId||''} onChange={e=>pick(Number(e.target.value))}><option value="">Choose a menu item…</option>{Array.from(new Set(menu.map(m=>m.category))).map(c=><optgroup label={c} key={c}>{menu.filter(m=>m.category===c).map(m=><option key={m.id} value={m.id}>{m.name}{recipes.some(r=>r.menu_item_id===m.id)?' ✓':''}</option>)}</optgroup>)}</select></div>
    {item&&<><ul className="line-editor">{rows.map(r=>{const s=stock.find(x=>x.id===r.id);return <li key={r.id}><span>{s?.name}</span><span className="qty"><input inputMode="decimal" aria-label={`${s?.name} used per ${item.name}`} value={r.qty} onChange={e=>setRows(v=>v.map(x=>x.id===r.id?{...x,qty:e.target.value}:x))}/> {s?.unit}</span><button type="button" className="link danger-link" onClick={()=>setRows(v=>v.filter(x=>x.id!==r.id))}>Remove</button></li>;})}{!rows.length&&<li className="hint">Selling {item.name} doesn’t change stock yet.</li>}</ul>
      <div className="add-row"><select aria-label="Add a stock item" value={adding} onChange={e=>setAdding(e.target.value)}><option value="">Add a stock item…</option>{stock.filter(s=>!rows.some(r=>r.id===s.id)).map(s=><option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}</select><button type="button" className="btn" disabled={!adding} onClick={()=>{setRows(v=>[...v,{id:Number(adding),qty:'1'}]);setAdding('');}}>Add</button></div>
      <div className="sheet-actions"><button className="btn primary" disabled={saving} onClick={()=>void save()}>{saving?'Saving…':`Save ${item.name}`}</button></div></>}
    {linked.length>0&&<><h3>Linked to stock</h3><ul className="recipe-list">{linked.map(m=><li key={m.id}><button className="link" onClick={()=>pick(m.id)}>{m.name}</button><span className="hint">{recipes.filter(r=>r.menu_item_id===m.id).map(r=>`${peso(r.qty)} ${r.unit} ${r.name}`).join(' · ')}</span></li>)}</ul></>}
  </div>;
}
