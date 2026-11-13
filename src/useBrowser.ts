import { useCallback, useEffect, useRef, useState } from 'react';
import { applyTabUpdate, closeTab, createTab, HOME, isInternal, loadData, pageTitle, recordVisit, resolveAddress, STORAGE_KEY } from './model';
import { command, desktop, onNative } from './native';
import type { Bookmark, Bounds, BrowserData, Download, TabUpdate } from './types';

function initialData() { try { return loadData(localStorage.getItem(STORAGE_KEY)); } catch { return loadData(null); } }
export function useBrowser() {
  const [data, setData] = useState(initialData);
  const [tabs, setTabs] = useState(() => data.settings.restoreSession && data.session.length ? data.session.map(t => ({...createTab(t.url), title:t.title})) : [createTab()]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [toast, setToast] = useState('');
  const [panel, setPanel] = useState<'history' | 'bookmarks' | 'downloads' | 'cookies' | null>(null);
  const state = useRef({ tabs, activeId, data }); state.current = { tabs, activeId, data };
  const created = useRef(new Set<string>());
  const closed = useRef<Bookmark[]>([]);
  const navigation = useRef(new Map<string,number>());
  const bounds = useRef<Bounds>({x:0,y:132,width:1000,height:600});
  const queue = useRef(Promise.resolve());
  const active = tabs.find(tab => tab.id === activeId) || tabs[0];
  const notify = useCallback((message: string) => setToast(message), []);
  const enqueue = useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch(error => notify(String(error).replace(/^Error: /, '')));
    return queue.current;
  }, [notify]);
  const ensureTab = useCallback(async (id: string, url: string) => {
    if (!created.current.has(id)) {
      await command('create_tab', { id, url, bounds: bounds.current });
      created.current.add(id);
    }
  }, []);
  const layout = useCallback((rect: Bounds) => {
    bounds.current = rect;
    void command('resize_content', { bounds:rect }).catch(e => notify(String(e)));
  }, [notify]);

  const topology = tabs.map(tab => `${tab.id}:${isInternal(tab.url)}`).join('|');
  useEffect(() => {
    void enqueue(async () => {
      const s = state.current;
      for (const id of created.current) if (!s.tabs.some(t => t.id === id)) { await command('close_tab', {id}); created.current.delete(id); }
      const tab = s.tabs.find(t => t.id === s.activeId);
      if (tab && !isInternal(tab.url)) await ensureTab(tab.id, tab.url);
      const current=state.current.tabs.find(t=>t.id===state.current.activeId);
      if(current&&!isInternal(current.url)&&!created.current.has(current.id))return;
      await command('activate_tab', { id:current && !isInternal(current.url) ? current.id : null, bounds:bounds.current });
    });
  }, [topology, activeId, enqueue, ensureTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({...data, session:tabs.map(({url,title}) => ({url,title}))})); }
      catch { notify('Storage is full. Clear older browsing history in Settings.'); }
    }, 200);
    return () => clearTimeout(timer);
  }, [data, tabs, notify]);
  useEffect(() => {
    const save = () => { try { const s=state.current; localStorage.setItem(STORAGE_KEY, JSON.stringify({...s.data,session:s.tabs.map(({url,title})=>({url,title}))})); } catch { /* normal save surfaces storage failures */ } };
    window.addEventListener('beforeunload',save); return () => window.removeEventListener('beforeunload',save);
  }, []);
  useEffect(() => { if (!toast) return; const timer=setTimeout(()=>setToast(''),4200); return ()=>clearTimeout(timer); }, [toast]);

  const newTab = useCallback((url = HOME) => {
    const tab=createTab(url); setTabs(prev=>[...prev,tab]); setActiveId(tab.id); setPanel(panel=>panel==='cookies'?panel:null); return tab.id;
  }, []);
  const removeTab = useCallback((id: string) => {
    const s=state.current; const tab=s.tabs.find(t=>t.id===id);
    if (tab) closed.current = [{url:tab.url,title:tab.title}, ...closed.current].slice(0,20);
    const result=closeTab(s.tabs,id,s.activeId); setTabs(result.tabs); setActiveId(result.activeId);
  }, []);
  const restoreTab = useCallback(() => { const tab=closed.current.shift(); if (tab) newTab(tab.url); else notify('No recently closed tabs.'); }, [newTab,notify]);
  const go = useCallback((input: string, id = state.current.activeId) => {
    const url=resolveAddress(input,state.current.data.settings.engine);
    const generation=(navigation.current.get(id)||0)+1;
    navigation.current.set(id,generation);
    const nextTabs=state.current.tabs.map(t=>t.id===id ? {...t,url,title:pageTitle(url),loading:!isInternal(url),canGoBack:false,canGoForward:false} : t);
    state.current={...state.current,tabs:nextTabs};
    setTabs(nextTabs);
    setPanel(panel=>panel==='cookies'?panel:null);
    if (!isInternal(url)) void enqueue(async()=>{
      if(navigation.current.get(id)!==generation||!state.current.tabs.some(t=>t.id===id&&!isInternal(t.url)))return;
      if (created.current.has(id)) await command('navigate_tab',{id,url}); else await ensureTab(id,url);
      if (state.current.activeId===id&&navigation.current.get(id)===generation&&state.current.tabs.some(t=>t.id===id&&!isInternal(t.url))) await command('activate_tab',{id,bounds:bounds.current});
    });
  }, [enqueue,ensureTab]);
  const action = useCallback((name: string, value?: unknown) => {
    const tab=state.current.tabs.find(t=>t.id===state.current.activeId);
    if (!tab || isInternal(tab.url)) return;
    void command('tab_action',{id:tab.id,action:name,value}).catch(error=>notify(String(error)));
  }, [notify]);
  const zoom = useCallback((delta: number | 'reset')=> {
    const tab=state.current.tabs.find(t=>t.id===state.current.activeId)!;
    if(isInternal(tab.url))return;
    const value=delta==='reset'?1:Math.round(Math.min(3,Math.max(.3,tab.zoom+delta))*10)/10;
    setTabs(prev=>prev.map(t=>t.id===tab.id?{...t,zoom:value}:t)); action('zoom',value);
  }, [action]);
  const bookmark = useCallback(()=>{
    const tab=state.current.tabs.find(t=>t.id===state.current.activeId)!;
    if(isInternal(tab.url)) { notify('Open a website to bookmark it.'); return; }
    const exists=state.current.data.bookmarks.some(b=>b.url===tab.url);
    setData(prev=>({...prev,bookmarks:exists?prev.bookmarks.filter(b=>b.url!==tab.url):[...prev.bookmarks,{url:tab.url,title:tab.title}]}));
    notify(exists?'Bookmark removed.':'Page bookmarked.');
  },[notify]);
  const openPage = useCallback((name:string)=> {
    const url=`mxplorer://${name}`;
    const existing=state.current.tabs.find(t=>t.url===url);
    if(existing) setActiveId(existing.id); else newTab(url);
    setPanel(null);
  },[newTab]);

  useEffect(()=> {
    let cancelled=false; const disposers: (()=>void)[]=[];
    const subscribe=async<T,>(name:string,handler:(payload:T)=>void)=>{
      const unlisten=await onNative<T>(name,handler); if(cancelled) unlisten(); else disposers.push(unlisten);
    };
    void subscribe<TabUpdate>('tab-update', payload=> {
      if (!state.current.tabs.some(t=>t.id===payload.id)) return;
      // Reject unexpected local URLs even if a malformed guest event reaches the chrome.
      if(payload.url && !/^https?:\/\//i.test(payload.url)) return;
      const tab=state.current.tabs.find(t=>t.id===payload.id)!;
      if(isInternal(tab.url))return;
      setTabs(prev=>applyTabUpdate(prev,payload));
      const page={url:payload.url||tab.url,title:payload.title||tab.title};
      if(payload.error)notify(payload.error);
      if(payload.loading===false&&!payload.error) setData(prev=>({...prev,history:recordVisit(prev.history,page)}));
      else if(payload.title) setData(prev=>({...prev,history:prev.history.map((v,i)=>i===0&&v.url===page.url?{...v,title:page.title}:v)}));
    });
    void subscribe<{url:string}>('new-tab',({url})=>{ if(/^https?:\/\//i.test(url)) newTab(url); });
    void subscribe<Download>('download-update', download=> {
      setData(prev=>({...prev,downloads:[download,...prev.downloads.filter(d=>d.id!==download.id)].slice(0,200)}));
      if(download.status==='completed') notify(`Downloaded ${download.name}`);
      if(download.status==='failed') notify(`Download failed: ${download.name}`);
    });
    return ()=>{cancelled=true;disposers.forEach(dispose=>dispose());};
  },[newTab,notify]);

  const updateData = useCallback((update:(data:BrowserData)=>BrowserData)=>setData(update),[]);
  const nativeWindow = useCallback((name:string)=>void command('window_action',{action:name}).catch(e=>notify(String(e))),[notify]);
  return {data,tabs,activeId,active,toast,panel,setPanel,setActiveId,newTab,removeTab,restoreTab,go,action,zoom,bookmark,openPage,updateData,layout,notify,nativeWindow,desktop};
}
export type Browser = ReturnType<typeof useBrowser>;
