import {useCallback,useEffect,useRef,useState} from 'react';
import {command,desktop} from '../native';
import {emptySnapshot} from './types';
import type {CookieSnapshot} from './types';

export function useCookies(url:string|null){
  const [snapshot,setSnapshot]=useState<CookieSnapshot>(emptySnapshot);
  const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(desktop);const [error,setError]=useState('');
  const current=useRef({url,epoch:0,request:0,mutation:false});
  if(current.current.url!==url)current.current={url,epoch:current.current.epoch+1,request:current.current.request+1,mutation:false};
  const refresh=useCallback(async()=>{
    if(!desktop||current.current.mutation)return;
    const epoch=current.current.epoch;const request=++current.current.request;
    try{
      const result=await command<CookieSnapshot>('get_cookies',{url:current.current.url});
      if(current.current.epoch===epoch&&current.current.request===request){setSnapshot(result);setError(result.error||'');setLoading(false);}
    }catch(e){if(current.current.epoch===epoch&&current.current.request===request){setError(String(e).replace(/^Error: /,''));setLoading(false);}}
  },[]);
  useEffect(()=>{
    setSnapshot(emptySnapshot());setError('');setLoading(desktop);setBusy(false);
    void refresh();const timer=setInterval(()=>void refresh(),2500);
    return()=>{clearInterval(timer);current.current.request++;};
  },[url,refresh]);
  const run=useCallback(async(name:string,args:Record<string,unknown>)=>{
    if(!desktop){setError('Cookie changes are available in the desktop app.');return false;}
    if(current.current.mutation)return false;
    const epoch=current.current.epoch;++current.current.request;current.current.mutation=true;setBusy(true);setError('');
    try{
      const result=await command<CookieSnapshot>(name,args);
      if(current.current.epoch!==epoch)return false;
      setSnapshot(result);setError(result.error||'');return !result.error;
    }catch(e){if(current.current.epoch===epoch)setError(String(e).replace(/^Error: /,''));return false;}
    finally{if(current.current.epoch===epoch){current.current.mutation=false;setBusy(false);}}
  },[]);
  return {snapshot,busy,loading,error,setError,refresh,run};
}
