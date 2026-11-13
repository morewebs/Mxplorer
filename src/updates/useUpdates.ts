import {useCallback,useEffect,useRef,useState} from 'react';
import {command,desktop,onNative} from '../native';
import {APP_VERSION} from '../version';

export type UpdateChannel='stable'|'nightly';
export interface UpdateStatus {
  currentVersion:string;channel:UpdateChannel;installed:boolean;
  phase:'idle'|'checking'|'available'|'downloading'|'ready'|'installing'|'error';
  progress:number|null;availableVersion:string|null;releaseNotes:string|null;
  downloadBytes:number|null;fullBytes:number|null;delta:boolean;
  error:string|null;lastCheckedAt:number|null;channelSwitch:boolean;
}
const initial:UpdateStatus={currentVersion:APP_VERSION,channel:'stable',installed:false,phase:'idle',progress:null,availableVersion:null,releaseNotes:null,downloadBytes:null,fullBytes:null,delta:false,error:null,lastCheckedAt:null,channelSwitch:false};

export function useUpdates(){
  const [status,setStatus]=useState<UpdateStatus>(initial);
  const current=useRef(status);const operation=useRef(false);const mounted=useRef(true);
  const accept=useCallback((next:UpdateStatus|undefined)=>{
    if(next&&mounted.current){current.current=next;setStatus(next);}
  },[]);
  const run=useCallback(async(name:string,args?:Record<string,unknown>)=>{
    if(!desktop||operation.current)return false;
    operation.current=true;
    try{const next=await command<UpdateStatus>(name,args);accept(next);return next?.phase!=='error';}
    catch(error){accept({...current.current,phase:'error',progress:null,error:String(error).replace(/^Error: /,'')});return false;}
    finally{operation.current=false;}
  },[accept]);
  const check=useCallback(()=>run('check_for_updates'),[run]);
  useEffect(()=>{
    mounted.current=true;let cancelled=false;let dispose:(()=>void)|undefined;
    if(desktop){
      void onNative<UpdateStatus>('update-status',accept).then(unlisten=>{if(cancelled)unlisten();else dispose=unlisten;}).catch(()=>{});
      void command<UpdateStatus>('get_update_status').then(next=>{if(!cancelled)accept(next);}).catch(error=>{if(!cancelled)accept({...current.current,phase:'error',error:String(error).replace(/^Error: /,'')});});
    }
    const backgroundCheck=()=>{
      if(current.current.installed&&!operation.current&&['idle','available','error'].includes(current.current.phase))void check();
    };
    const startup=setTimeout(backgroundCheck,8000);
    const timer=setInterval(backgroundCheck,15*60*1000);
    return()=>{cancelled=true;mounted.current=false;dispose?.();clearTimeout(startup);clearInterval(timer);};
  },[accept,check]);
  const changeChannel=useCallback(async(channel:UpdateChannel)=>{
    if(await run('set_update_channel',{channel}))await check();
  },[run,check]);
  return {status,desktop,check,changeChannel,download:()=>run('download_update'),install:()=>run('install_update')};
}
export type Updates=ReturnType<typeof useUpdates>;
