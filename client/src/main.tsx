import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Admin } from './admin/Admin';
import { Inventory } from './inventory/Inventory';
import { Kitchen } from './kitchen/Kitchen';
import { Launcher } from './launcher/Launcher';
import { Login } from './login/Login';
import { Pos } from './pos/Pos';
import { roleName } from './shared/format';
import { screenPath, STORE, STORE_NAME, storeUrl } from './shared/store';
import type { Role } from './shared/types';
import './styles.css';

function App(){
  const path=screenPath();
  const params=new URLSearchParams(location.search);
  const loginRole=(['pos','barista','kitchen','inventory','admin'].includes(params.get('role')??'')?params.get('role'):'admin') as Role;
  useEffect(()=>{
    const role:Role|undefined=path==='/login'||path==='/login.html'?loginRole:(['pos','barista','kitchen','inventory','admin'].includes(path.slice(1))?path.slice(1) as Role:undefined);
    document.title=role?`${STORE_NAME} · ${roleName[role]}`:`${STORE_NAME} · POS System`;
    if(STORE==='rairock'){
      document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href','/rairock/brand/icon-512.png');
      document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.setAttribute('href','/rairock/brand/icon-512.png');
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content','#08740C');
    }
    if(role){
      let link=document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if(!link){link=document.createElement('link');link.rel='manifest';document.head.append(link);}
      link.href=storeUrl(`/${role}.webmanifest`);
    }
  },[path,loginRole]);
  if(path==='/login'||path==='/login.html')return <Login role={loginRole}/>;
  if(path==='/pos'||path==='/barista')return <Pos role={path==='/barista'?'barista':'pos'}/>;
  if(path==='/kitchen')return <Kitchen/>;
  if(path==='/inventory')return <Inventory/>;
  if(path==='/admin')return <Admin/>;
  return <Launcher/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
