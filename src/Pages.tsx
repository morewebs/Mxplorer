import { useState } from 'react';
import { ArrowDownToLine, Bookmark, Check, Clock3, Download, ExternalLink, FolderOpen, Globe2, History, Plus, Search, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Browser } from './useBrowser';
import type { Engine } from './types';
import { engines, hostname, isInternal } from './model';
import { command } from './native';
import { Dialog, EmptyState, IconButton, Mark, SiteIcon } from './ui';

export {default as NewTab} from './NewTab';

export function Library({browser:b,page,compact=false}:{browser:Browser;page:'history'|'bookmarks'|'downloads';compact?:boolean}) {
  const [filter,setFilter]=useState(''); const [confirm,setConfirm]=useState(false);
  const label=page[0].toUpperCase()+page.slice(1);
  const icon=page==='history'?<History size={23}/>:page==='bookmarks'?<Bookmark size={23}/>:<ArrowDownToLine size={23}/>;
  const items=page==='history'?b.data.history:page==='bookmarks'?b.data.bookmarks:b.data.downloads;
  const visible=items.filter(item=>`${'title' in item?item.title:item.name} ${item.url}`.toLowerCase().includes(filter.toLowerCase()));
  const clear=()=>{if(!confirm){setConfirm(true);return;} b.updateData(d=>({...d,[page]:[]}));setConfirm(false);};
  return <div className={`library ${compact?'compact':''}`}><div className="library-header"><div className="page-title">{icon}<h1>{label}</h1></div>{compact&&<IconButton label="Close panel" onClick={()=>b.setPanel(null)}><X size={18}/></IconButton>}</div>
    {!compact&&<p className="page-description">{page==='history'?'Find your way back to somewhere good.':page==='bookmarks'?'The places worth keeping close.':'Files you’ve saved from the web.'}</p>}
    <div className="library-tools"><div className="filter-input"><Search size={16}/><input aria-label={`Search ${page}`} placeholder={`Search ${page}`} value={filter} onChange={e=>setFilter(e.target.value)}/>{filter&&<IconButton label="Clear search" onClick={()=>setFilter('')}><X size={14}/></IconButton>}</div>{page==='downloads'&&!compact&&<button className="secondary-button" onClick={()=>void command('open_downloads').catch(e=>b.notify(String(e)))}><FolderOpen size={16}/>Open folder</button>}</div>
    {items.length>0&&<div className="list-meta"><span>{visible.length} {visible.length===1?'item':'items'}</span><button className="text-button" onClick={clear}>{confirm?'Confirm clear':`Clear ${page==='downloads'?'list':page}`}</button>{confirm&&<button className="text-button" onClick={()=>setConfirm(false)}>Cancel</button>}</div>}
    {!visible.length?<EmptyState icon={icon} heading={filter?'No matches':page==='history'?'A fresh start':page==='bookmarks'?'Keep a good thing':"You’re all caught up"}>{filter?'Try a different search.':page==='history'?'Your browsing history will appear here.':page==='bookmarks'?<>Bookmark any website with the star in the address bar or <kbd>Ctrl</kbd> + <kbd>D</kbd>.</>:'Downloads from websites will appear here.'}</EmptyState>:<div className="library-list">{visible.map((item,index)=>{
      if('status' in item) return <div className="download-row" key={item.id}><div className={`download-status ${item.status}`}><Download size={19}/></div><div className="row-info"><strong>{item.name}</strong><small>{item.status==='completed'?'Completed':item.status==='failed'?'Failed or interrupted':'Downloading…'}{!compact&&` • ${hostname(item.url)}`}</small>{!compact&&item.path&&<small className="download-path" title={item.path}>{item.path}</small>}</div>{item.status==='completed'&&<IconButton label="Show download folder" onClick={()=>void command('open_downloads').catch(e=>b.notify(String(e)))}><FolderOpen size={17}/></IconButton>}<IconButton label={`Remove ${item.name} from list`} onClick={()=>b.updateData(d=>({...d,downloads:d.downloads.filter(v=>v.id!==item.id)}))}><X size={15}/></IconButton></div>;
      return <div className="library-row" key={`${item.url}-${'visitedAt' in item?item.visitedAt:index}`}><button className="library-link" onClick={()=>compact?b.go(item.url):b.newTab(item.url)}><SiteIcon url={item.url} title={item.title}/><span className="row-info"><strong>{item.title||hostname(item.url)}</strong><small>{compact?hostname(item.url):item.url}</small></span>{'visitedAt' in item&&typeof item.visitedAt==='number'&&<time dateTime={new Date(item.visitedAt).toISOString()}>{new Date(item.visitedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</time>}</button><IconButton label={`Remove ${item.title}`} onClick={()=>b.updateData(d=>({...d,[page]:page==='history'?d.history.filter(v=>v!==item):d.bookmarks.filter(v=>v.url!==item.url)}))}><Trash2 size={15}/></IconButton></div>;
    })}</div>}
  </div>;
}

export function Settings({browser:b}:{browser:Browser}) {
  const [clearing,setClearing]=useState(false); const [busy,setBusy]=useState(false); const [cookies,setCookies]=useState(false);
  const settings=b.data.settings;
  const update=<K extends keyof typeof settings>(key:K,value:typeof settings[K])=>b.updateData(d=>({...d,settings:{...d.settings,[key]:value}}));
  const clear=async()=>{
    setBusy(true);
    try { if(cookies) await command('clear_browsing_data'); b.updateData(d=>({...d,history:[],downloads:[]}));setClearing(false);b.notify(cookies?'History, cookies, and cached site data cleared.':'History and download list cleared.'); }
    catch(error){b.notify(String(error));} finally{setBusy(false);}
  };
  return <div className="settings-page"><div className="page-title"><Settings2 size={24}/><h1>Settings</h1></div><p className="page-description">Make yourself at home.</p>
    <section className="settings-section"><h2>Browsing</h2><div className="setting-row"><div><strong>Search engine</strong><p>Used by the address bar and new-tab search.</p></div><select aria-label="Search engine" value={settings.engine} onChange={e=>update('engine',e.target.value as Engine)}>{Object.entries(engines).map(([key,engine])=><option key={key} value={key}>{engine.name}</option>)}</select></div><Toggle title="Continue where you left off" description="Reopen your tabs when Mxplorer starts." checked={settings.restoreSession} onChange={v=>update('restoreSession',v)}/><Toggle title="Show bookmarks bar" description="Keep saved websites below the address bar." checked={settings.showBookmarksBar} onChange={v=>update('showBookmarksBar',v)}/></section>
    <section className="settings-section"><h2>Privacy & data</h2><div className="setting-row"><div><strong>Clear browsing data</strong><p>Choose whether to include cookies and cached website data.</p></div><button className="secondary-button" onClick={()=>setClearing(true)}>Choose what to clear</button></div><div className="privacy-note"><ShieldCheck size={20}/><p>Your bookmarks, history, and preferences are stored on this device. Mxplorer does not include analytics or cloud sync. Websites and your search engine have their own privacy policies.</p></div></section>
    <section className="settings-section"><h2>Keyboard shortcuts</h2><div className="keyboard-grid">{[['New tab','Ctrl + T'],['Close tab','Ctrl + W'],['Reopen closed tab','Ctrl + Shift + T'],['Address bar','Ctrl + L'],['Bookmark page','Ctrl + D'],['Find on page','Ctrl + F'],['History','Ctrl + H'],['Downloads','Ctrl + J'],['Next tab','Ctrl + Tab'],['Full screen','F11']].map(([name,key])=><div key={name}><span>{name}</span><kbd>{key}</kbd></div>)}</div></section>
    <div className="about"><div className="about-logo"><Mark size={29}/></div><div><strong>Mxplorer <span>0.1.1</span></strong><p>Built with Tauri · Powered by Microsoft WebView2 on Windows</p></div></div>
    {clearing&&<Dialog title="Clear browsing data" onClose={()=>!busy&&setClearing(false)}><p className="dialog-copy">This clears all browsing history and the download list. Downloaded files and bookmarks are kept.</p><label className="checkbox-label"><input type="checkbox" checked={cookies} onChange={e=>setCookies(e.target.checked)}/>Also clear cookies and cached site data</label>{cookies&&<p className="dialog-copy">You’ll be signed out of websites. Open pages may need to be reloaded.</p>}<div className="dialog-actions"><button disabled={busy} className="secondary-button" onClick={()=>setClearing(false)}>Cancel</button><button disabled={busy} className="primary-button" onClick={()=>void clear()}>{busy?'Clearing…':'Clear data'}</button></div></Dialog>}
  </div>;
}
function Toggle({title,description,checked,onChange}:{title:string;description:string;checked:boolean;onChange:(v:boolean)=>void}) {
  return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><button type="button" className={`toggle ${checked?'checked':''}`} role="switch" aria-checked={checked} aria-label={title} onClick={()=>onChange(!checked)}><span/></button></div>;
}

export function BrowserMenu({browser:b,onClose}:{browser:Browser;onClose:()=>void}) {
  const internal=isInternal(b.active.url);
  const items=[{label:'New tab',shortcut:'Ctrl+T',icon:<Plus/>,onClick:()=>b.newTab()},{label:'History',shortcut:'Ctrl+H',icon:<Clock3/>,onClick:()=>b.setPanel('history')},{label:'Bookmarks',shortcut:'Ctrl+Shift+O',icon:<Bookmark/>,onClick:()=>b.setPanel('bookmarks')},{label:'Downloads',shortcut:'Ctrl+J',icon:<ArrowDownToLine/>,onClick:()=>b.setPanel('downloads')}];
  return <div className="browser-menu"><div className="panel-heading"><span><Mark size={20}/>Mxplorer</span><IconButton label="Close menu" onClick={onClose}><X size={17}/></IconButton></div>{items.map(i=><button className="menu-item" key={i.label} onClick={i.onClick}>{i.icon}<span>{i.label}</span><kbd>{i.shortcut}</kbd></button>)}<div className="menu-divider"/><div className="zoom-control"><span>Zoom</span><IconButton label="Zoom out" disabled={internal} onClick={()=>b.zoom(-.1)}>−</IconButton><button className="zoom-value" disabled={internal} title="Reset zoom" onClick={()=>b.zoom('reset')}>{Math.round(b.active.zoom*100)}%</button><IconButton label="Zoom in" disabled={internal} onClick={()=>b.zoom(.1)}>+</IconButton></div><button className="menu-item" disabled={internal} onClick={()=>{b.action('find');b.setPanel(null);}}><Search/><span>Find on page</span><kbd>Ctrl+F</kbd></button><button className="menu-item" onClick={()=>{b.action('print');b.setPanel(null);}}><ExternalLink/><span>Print page</span><kbd>Ctrl+P</kbd></button><div className="menu-divider"/><button className="menu-item" onClick={()=>b.openPage('settings')}><Settings2/><span>Settings</span></button><div className="menu-footer"><ShieldCheck size={14}/><span>Mxplorer 0.1.1</span><Check size={13}/></div></div>;
}

export function PreviewPage({url}:{url:string}) {return <div className="preview-page"><Globe2 size={40}/><h2>Open Mxplorer to browse</h2><p>Websites load in native WebView2 tabs in the desktop app.</p><a className="secondary-button" href={url} target="_blank" rel="noreferrer">Open in this browser<ExternalLink size={15}/></a><small>This web preview includes the interface and saved preferences.</small></div>;}

