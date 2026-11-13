import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Bookmark, ChevronDown, Clock3, Cookie, Globe2, Home, LockKeyhole, Maximize2, Minus, MoreHorizontal, Plus, RotateCw, Star, X } from 'lucide-react';
import { useBrowser } from './useBrowser';
import { BrowserMenu, Library, NewTab, PreviewPage, Settings } from './Pages';
import { HOME, hostname, isInternal } from './model';
import { command,onNative } from './native';
import TabPicker from './TabPicker';
import {browserShortcut} from './keyboard';
import {useNativeOverlay} from './useNativeOverlay';
import { IconButton, Mark } from './ui';
import CookiePanel from './cookies/CookiePanel';

export default function App() {
  const b=useBrowser();
  const [address,setAddress]=useState('');
  const [focused,setFocused]=useState(false);
  const [popup,setPopup]=useState<'tabs'|'menu'|null>(null);
  const selectOnClick=useRef(false);
  const addressRef=useRef<HTMLInputElement>(null);
  const contentRef=useRef<HTMLDivElement>(null);
  const actionsRef=useRef<(action:string)=>void>(()=>{});
  const internal=isInternal(b.active.url);
  useEffect(()=>{setAddress(b.active.url===HOME?'':b.active.url);setFocused(false);setPopup(null);},[b.activeId]);
  useEffect(()=>{if(!focused)setAddress(b.active.url===HOME?'':b.active.url);},[b.active.url,focused]);
  const focusAddress=useCallback(()=>{setPopup(null);addressRef.current?.focus();addressRef.current?.select();},[]);
  const dismissPopup=()=>{setPopup(null);void command('set_overlay',{open:false}).then(()=>b.action('focus'));};
  const handleAction=(action:string)=>{
    if(action.startsWith('select-tab-')){const n=Number(action.slice(11));b.setActiveId(b.tabs[n===9?b.tabs.length-1:Math.min(n-1,b.tabs.length-1)].id);return;}
    switch(action){
      case 'escape':
        if(popup){dismissPopup();break;}
        setFocused(false);b.setPanel(null);addressRef.current?.blur();b.action('stop');break;
      case 'new-tab': b.newTab();setTimeout(focusAddress,30);break;
      case 'close-tab': b.removeTab(b.activeId);break;
      case 'restore-tab': b.restoreTab();break;
      case 'focus-address': focusAddress();break;
      case 'reload': b.action('reload');break;
      case 'hard-reload': b.action('reload',true);break;
      case 'back': b.action('back');break;
      case 'forward': b.action('forward');break;
      case 'stop': b.action('stop');break;
      case 'history': b.openPage('history');break;
      case 'downloads': b.openPage('downloads');break;
      case 'bookmarks': b.openPage('bookmarks');break;
      case 'toggle-bookmarks-bar': b.updateData(d=>({...d,settings:{...d.settings,showBookmarksBar:!d.settings.showBookmarksBar}}));break;
      case 'search-tabs': setPopup(p=>p==='tabs'?null:'tabs');break;
      case 'bookmark-page': b.bookmark();break;
      case 'find': b.action('find');break;
      case 'print': b.action('print');break;
      case 'next-tab': b.setActiveId(b.tabs[(b.tabs.findIndex(t=>t.id===b.activeId)+1)%b.tabs.length].id);break;
      case 'previous-tab': b.setActiveId(b.tabs[(b.tabs.findIndex(t=>t.id===b.activeId)-1+b.tabs.length)%b.tabs.length].id);break;
      case 'zoom-in': b.zoom(.1);break;
      case 'zoom-out': b.zoom(-.1);break;
      case 'zoom-reset': b.zoom('reset');break;
      case 'fullscreen': b.nativeWindow('fullscreen');break;
    }
  };
  actionsRef.current=handleAction;
  useEffect(()=>{
    let disposed=false;let unlisten=()=>{};
    void onNative<{action:string}>('browser-shortcut',event=>actionsRef.current(event.action)).then(fn=>{if(disposed)fn();else unlisten=fn;});
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){actionsRef.current('escape');return;}
      const action=browserShortcut(e);
      if(action){e.preventDefault();actionsRef.current(action);}
    };
    window.addEventListener('keydown',key);return()=>{disposed=true;unlisten();window.removeEventListener('keydown',key);};
  },[b.tabs,b.setActiveId,b.setPanel,b.action]);

  const suggestions=focused&&address.trim()&&address!==b.active.url?[...b.data.bookmarks,...b.data.history].filter((v,i,all)=>all.findIndex(a=>a.url===v.url)===i&&`${v.title} ${v.url}`.toLowerCase().includes(address.toLowerCase())).slice(0,4):[];
  const snapshot=useNativeOverlay(!internal&&(!!popup||suggestions.length>0),b.activeId);
  useEffect(()=>{
    const element=contentRef.current;if(!element)return;
    const update=()=>{const r=element.getBoundingClientRect();b.layout({x:Math.round(r.x),y:Math.round(r.y),width:Math.max(1,Math.round(r.width)),height:Math.max(1,Math.round(r.height))});};
    const observer=new ResizeObserver(update);observer.observe(element);window.addEventListener('resize',update);update();
    return()=>{observer.disconnect();window.removeEventListener('resize',update);};
  },[b.layout,b.panel,b.data.settings.showBookmarksBar]);
  const submit=(value=address)=>{setPopup(null);setFocused(false);addressRef.current?.blur();b.go(value);};
  const bookmarked=b.data.bookmarks.some(v=>v.url===b.active.url);

  return <div className="app-shell">
    <header className="browser-chrome">
      <div className="tab-strip" onDoubleClick={e=>{if(e.target===e.currentTarget)b.nativeWindow('maximize');}}>
        <button className="app-badge" aria-label="Mxplorer home" onClick={()=>b.go(HOME)}><Mark size={24}/></button>
        <div className="tabs" role="tablist" aria-label="Browser tabs">{b.tabs.map(tab=><div key={tab.id} className={`tab ${tab.id===b.activeId?'active':''}`}><button role="tab" aria-selected={tab.id===b.activeId} className="tab-select" title={tab.title} onClick={()=>b.setActiveId(tab.id)} onMouseDown={e=>{if(e.button===1)e.preventDefault();}} onAuxClick={e=>{if(e.button===1)b.removeTab(tab.id);}}>{tab.loading?<span className="spinner"/>:isInternal(tab.url)?<Mark size={16}/>:<Globe2 size={14}/>}<span>{tab.title}</span></button><IconButton className="tab-close" label={`Close ${tab.title}`} onClick={()=>b.removeTab(tab.id)}><X size={13}/></IconButton></div>)}</div>
        <IconButton label="New tab (Ctrl+T)" className="new-tab-button" onClick={()=>{b.newTab();setTimeout(focusAddress,30);}}><Plus size={18}/></IconButton>
        <div className="titlebar-drag" data-tauri-drag-region onMouseDown={e=>{if(e.button===0&&e.detail!==2)b.nativeWindow('start-drag');}} onDoubleClick={()=>b.nativeWindow('maximize')}/>
        <IconButton label="Search tabs" className="tab-search-button" aria-haspopup="dialog" aria-expanded={popup==='tabs'} onClick={()=>setPopup(p=>p==='tabs'?null:'tabs')}><ChevronDown size={16}/></IconButton>
        <div className="window-controls"><IconButton label="Minimise window" onClick={()=>b.nativeWindow('minimize')}><Minus size={15}/></IconButton><IconButton label="Maximise window" onClick={()=>b.nativeWindow('maximize')}><Maximize2 size={12}/></IconButton><IconButton label="Close window" className="window-close" onClick={()=>b.nativeWindow('close')}><X size={16}/></IconButton></div>
      </div>
      <div className="navigation-toolbar">
        <div className="navigation-buttons"><IconButton label="Back (Alt+Left)" disabled={internal||!b.active.canGoBack} onClick={()=>b.action('back')}><ArrowLeft size={18}/></IconButton><IconButton label="Forward (Alt+Right)" disabled={internal||!b.active.canGoForward} onClick={()=>b.action('forward')}><ArrowRight size={18}/></IconButton><IconButton label={b.active.loading?'Stop loading':'Reload (Ctrl+R)'} disabled={internal} onClick={()=>b.action(b.active.loading?'stop':'reload')}>{b.active.loading?<X size={17}/>:<RotateCw size={17}/>}</IconButton><IconButton label="Home" onClick={()=>b.go(HOME)}><Home size={17}/></IconButton></div>
        <form className={`address-bar ${focused?'focused':''}`} onSubmit={e=>{e.preventDefault();submit();}}><span className="address-security" title={internal?'Mxplorer page':b.active.url.startsWith('https:')?'Connection uses HTTPS':'Connection is not encrypted'}>{internal?<Mark size={17}/>:b.active.url.startsWith('https:')?<LockKeyhole size={14}/>:<Globe2 size={15}/>}</span><input ref={addressRef} aria-label="Address bar" spellCheck={false} autoComplete="off" placeholder="Search or enter a website address" value={address} onMouseDown={()=>{selectOnClick.current=document.activeElement!==addressRef.current;}} onFocus={()=>{setFocused(true);setPopup(null);}} onBlur={()=>setTimeout(()=>setFocused(false),150)} onChange={e=>setAddress(e.target.value)} onClick={e=>{if(selectOnClick.current)e.currentTarget.select();selectOnClick.current=false;}}/>{b.active.zoom!==1&&<button type="button" className="address-zoom" onClick={()=>b.zoom('reset')}>{Math.round(b.active.zoom*100)}%</button>}<IconButton label={bookmarked?'Remove bookmark (Ctrl+D)':'Bookmark this page (Ctrl+D)'} disabled={internal} className={bookmarked?'bookmarked':''} onClick={b.bookmark}><Star size={16} fill={bookmarked?'currentColor':'none'}/></IconButton></form>
        <div className="toolbar-actions"><IconButton label="Downloads (Ctrl+J)" className={b.panel==='downloads'?'selected':''} onClick={()=>{b.setPanel(b.panel==='downloads'?null:'downloads');}}><ArrowDownToLine size={18}/>{b.data.downloads.some(d=>d.status==='downloading')&&<span className="notification-dot"/>}</IconButton><IconButton label="Bookmarks" className={b.panel==='bookmarks'?'selected':''} onClick={()=>{b.setPanel(b.panel==='bookmarks'?null:'bookmarks');}}><Bookmark size={17}/></IconButton><IconButton label="Cookies" className={b.panel==='cookies'?'selected':''} onClick={()=>b.setPanel(b.panel==='cookies'?null:'cookies')}><Cookie size={18}/></IconButton><span className="toolbar-divider"/><IconButton label="Mxplorer menu" aria-haspopup="dialog" aria-expanded={popup==='menu'} className={popup==='menu'?'selected':''} onClick={()=>setPopup(p=>p==='menu'?null:'menu')}><MoreHorizontal size={21}/></IconButton></div>
      </div>
      {b.data.settings.showBookmarksBar&&<div className="bookmarks-bar">{b.data.bookmarks.length?b.data.bookmarks.slice(0,8).map(site=><button key={site.url} onClick={()=>b.go(site.url)} title={site.url}><Globe2 size={12}/><span>{site.title}</span></button>):<span className="bookmarks-hint">Add bookmarks with <kbd>Ctrl+D</kbd></span>}<button className="all-bookmarks" onClick={()=>b.setPanel(b.panel==='bookmarks'?null:'bookmarks')}><Bookmark size={12}/>All bookmarks</button></div>}
    {suggestions.length>0&&<div className="omnibox-results">{suggestions.map(site=><button key={site.url} onMouseDown={e=>e.preventDefault()} onClick={()=>submit(site.url)}><Clock3 size={16}/><span>{site.title}<small>{site.url}</small></span><ArrowRight size={15}/></button>)}</div>}
    </header>

    <div className="workspace"><main className={`page-content ${!internal?'web-content':''}`} ref={contentRef}>
      {internal?(b.active.url===HOME?<NewTab key={b.activeId} browser={b}/>:b.active.url==='mxplorer://settings'?<Settings browser={b}/>:<Library key={b.active.url} browser={b} page={b.active.url.slice(11) as 'history'|'bookmarks'|'downloads'}/>):!b.desktop?<PreviewPage url={b.active.url}/>:<div className="native-placeholder" aria-label={`Website: ${b.active.url}`}>{b.active.loading&&<><span className="spinner"/><span>Opening {hostname(b.active.url)}…</span></>}</div>}
      {snapshot&&!internal&&<img className="native-snapshot" src={snapshot} alt="" aria-hidden="true"/>}
    </main>
    {b.panel&&<aside className={`side-panel ${b.panel==='cookies'?'cookie-side-panel':''}`} aria-label={`${b.panel} panel`}>{b.panel==='cookies'?<CookiePanel browser={b}/>:<Library key={b.panel} browser={b} page={b.panel} compact/>}</aside>}
    </div>
    {popup&&<><div className="popover-dismiss" onMouseDown={dismissPopup}/><div className={`chrome-popover ${popup==='tabs'?'tabs-popover':'menu-popover'}`}>{popup==='tabs'?<TabPicker browser={b} onClose={()=>setPopup(null)}/>:<section role="dialog" aria-label="Mxplorer menu" onClick={e=>{if((e.target as HTMLElement).closest('.menu-item'))setPopup(null);}}><BrowserMenu browser={b} onClose={()=>setPopup(null)}/></section>}</div></>}
    {b.toast&&<div role="status" className="toast"><span>{b.toast}</span><IconButton label="Dismiss notification" onClick={()=>b.notify('')}><X size={14}/></IconButton></div>}
    {!b.desktop&&<div className="preview-badge" title="Run npm run desktop for native web browsing"><span/>Interface preview</div>}
  </div>;
}
