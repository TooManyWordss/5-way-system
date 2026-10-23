import { roleName } from '../shared/format';
import { STORE, STORE_NAME, storeUrl } from '../shared/store';
import type { Role } from '../shared/types';
import { Logo } from '../shared/ui';

export function Launcher() { return <main className="home"><a className="store-switch" href={STORE === 'rairock' ? '/' : '/rairock/'}>Open {STORE === 'rairock' ? 'Café Ambiente' : 'RaiRock Seafoods'}</a><Logo large /><p>{STORE_NAME} · Open each screen on its own device.</p><div className="home-links">{([['pos','Ring up orders and take payment'],['barista',"The barista's own till and receipts"],['kitchen','Live queue of tickets to prepare'],['inventory','Count stock, log deliveries and usage'],['admin',"Sales, reports, receipts, staff and inventory"]] as [Role,string][]).map(([r,d]) => <a href={storeUrl(`/login?role=${r}`)} key={r}><strong>{roleName[r]}</strong><span>{d}</span></a>)}<a href={storeUrl('/admin#live')}><strong>General panel</strong><span>Every screen at a glance: tills, kitchen, tables and stock (owner)</span></a></div></main>; }
