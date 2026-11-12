import { useEffect,useState } from 'react';
import {command} from './native';

// Child WebView2 controls sit above HTML. Freeze their last frame while chrome popovers are open.
export function useNativeOverlay(open:boolean,activeId:string) {
  const [snapshot,setSnapshot]=useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false;
    if(!open)setSnapshot(null);
    void command<string|null>('set_overlay',{open}).then(image=>{
      if(!cancelled)setSnapshot(open?image||null:null);
    }).catch(()=>{if(!cancelled)setSnapshot(null);});
    return()=>{cancelled=true;};
  },[open,activeId]);
  return snapshot;
}
