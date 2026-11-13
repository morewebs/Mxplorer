import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowDownToLine,ArrowUpFromLine,ChevronDown,Cookie,Pause,Play,Plus,RefreshCw,RotateCcw,Settings2,ShieldCheck,Trash2,X} from 'lucide-react';
import type {Browser} from '../useBrowser';
import {hostname,isWeb} from '../model';
import {EmptyState,IconButton} from '../ui';
import {cookieId,cookieKey,restoreModes} from './types';
import type {CookieKey,CookieRecord,RestoreMode,SavedCookie} from './types';
import {useCookies} from './useCookies';
import CookieForm from './CookieForm';
import CookieOptions,{rowInformation,useCookiePreferences} from './CookieOptions';
import {ExportForm,ImportForm} from './TransferForm';
import './cookies.css';

type Screen='list'|'add'|'import'|'export'|'options';
export default function CookiePanel({browser:b}:{browser:Browser}){
  const url=isWeb(b.active.url)?new URL(b.active.url).origin:null;
  const {snapshot,busy,loading,error,refresh,run}=useCookies(url);
  const {preferences,updatePreferences}=useCookiePreferences();
  const [view,setView]=useState<'live'|'saved'>(url?'live':'saved');
  const [screen,setScreen]=useState<Screen>('list');
  const [editing,setEditing]=useState<CookieRecord|null>(null);
  const [query,setQuery]=useState('');
  const [confirm,setConfirm]=useState<string|null>(null);
  useEffect(()=>{setView(url?'live':'saved');setScreen('list');setEditing(null);setQuery('');setConfirm(null);},[url]);
  const savedFor=(cookie:CookieRecord)=>snapshot.saved.find(s=>cookieId(s.cookie)===cookieId(cookie));
  const matches=(cookie:CookieRecord)=>`${cookie.name} ${cookie.domain} ${cookie.path}`.toLowerCase().includes(query.toLowerCase());
  const editingMissing=!!editing&&!snapshot.cookies.some(cookie=>cookieId(cookie)===cookieId(editing));
  const liveRows=editingMissing?[...snapshot.cookies,editing!]:snapshot.cookies;
  const cookies=liveRows.filter(matches),saved=snapshot.saved.filter(s=>matches(s.cookie));
  const back=()=>{setScreen('list');setEditing(null);setConfirm(null);};
  const save=async(record:CookieRecord,mode:RestoreMode,original:CookieKey|null)=>{
    if(!url)return false;
    const ok=await run('save_cookies',{url,cookies:[record],mode,original:original?cookieKey(original):null});
    if(ok){back();b.notify('Cookie saved. Reload the page to use the updated value.');}return ok;
  };
  const importCookies=async(records:CookieRecord[],mode:RestoreMode)=>{
    if(!url)return false;
    const ok=await run('save_cookies',{url,cookies:records,mode,original:null});
    if(ok){back();b.notify(`${records.length} ${records.length===1?'cookie':'cookies'} imported${mode==='none'?'.':' with auto-restore.'}`);}return ok;
  };
  const manageSaved=async(entry:SavedCookie,change:{enabled?:boolean;mode?:'missing'|'exact';remove?:boolean})=>{
    const ok=await run('set_saved_cookie',{key:cookieKey(entry.cookie),url,...change});
    if(ok&&change.remove)b.notify('Saved copy forgotten. The live cookie is kept.');
  };
  const remove=async(cookie:CookieRecord)=>{
    if(!url)return;
    if(await run('delete_cookies',{url,keys:[cookieKey(cookie)],forgetSaved:true})){
      setConfirm(null);if(editing&&cookieId(editing)===cookieId(cookie))setEditing(null);b.notify('Cookie and any saved copy deleted.');
    }
  };
  const controlsDisabled=busy||!b.desktop;
  const showActions=screen==='list'&&view==='live'&&!!url;
  const actionBar=<div className={`cookie-toolbar cookie-toolbar-${preferences.toolbarPosition}`} role="toolbar" aria-label="Cookie actions">
    <button disabled={controlsDisabled} onClick={()=>{setEditing(null);setScreen('add');}}><Plus size={18}/><span>Add</span></button>
    <button aria-label="Clear live cookies" disabled={controlsDisabled||!snapshot.cookies.length} onClick={()=>{setEditing(null);setConfirm(confirm==='clear'?null:'clear');}}><Trash2 size={17}/><span>Clear</span></button>
    <button disabled={controlsDisabled} onClick={()=>setScreen('import')}><ArrowDownToLine size={18}/><span>Import</span></button>
    <button disabled={controlsDisabled||!snapshot.cookies.length} onClick={()=>setScreen('export')}><ArrowUpFromLine size={18}/><span>Export</span></button>
  </div>;
  const formOptions={advanced:preferences.advanced,onAdvancedChange:(advanced:boolean)=>updatePreferences({advanced})};

  return <section className="cookie-panel" aria-label="Cookie editor">
    <header className="cookie-panel-header">
      <div><Cookie size={19}/><h1>Cookies</h1></div>
      <div className="cookie-header-actions">
        <IconButton label="Refresh cookies" disabled={controlsDisabled} onClick={()=>void refresh()}><RefreshCw size={15} className={loading?'spinner-icon':''}/></IconButton>
        <IconButton label="Cookie editor options" disabled={busy} onClick={()=>{setScreen('options');setEditing(null);setConfirm(null);}}><Settings2 size={16}/></IconButton>
        <IconButton label="Close cookie editor" onClick={()=>b.setPanel(null)}><X size={18}/></IconButton>
      </div>
    </header>
    <div className="cookie-site"><span>{url?hostname(url):'Saved cookies on this device'}</span>{url&&<button className="text-button" onClick={()=>b.action('reload')} title="Reload active website"><RotateCcw size={13}/>Reload page</button>}</div>
    {error&&<p role="alert" className="cookie-error cookie-panel-error">{error}</p>}
    {!b.desktop&&<p className="cookie-preview-note">Open the desktop app to read or change WebView2 cookies. Cookie data is not stored in this interface preview.</p>}
    {screen==='list'&&<div className="cookie-list-tools">
      <div className="cookie-view-tabs" role="tablist" aria-label="Cookie views">
        <button role="tab" aria-selected={view==='live'} onClick={()=>{setView('live');setConfirm(null);setEditing(null);}}>Current site<span>{snapshot.cookies.length}</span></button>
        <button role="tab" aria-selected={view==='saved'} onClick={()=>{setView('saved');setConfirm(null);setEditing(null);}}>Saved for restore<span>{snapshot.saved.length}</span></button>
      </div>
      <div className="filter-input cookie-filter"><input aria-label="Search cookies" placeholder="Search name, domain, or path" value={query} onChange={e=>{setQuery(e.target.value);setEditing(null);}}/>{query&&<IconButton label="Clear cookie search" onClick={()=>setQuery('')}><X size={14}/></IconButton>}</div>
    </div>}
    {showActions&&preferences.toolbarPosition==='top'&&actionBar}
    {screen==='list'&&confirm==='clear'&&<div className="cookie-confirm cookie-bulk-confirm">
      <p>Clear all live cookies for this site? Enabled saved copies will return automatically.</p>
      <button className="secondary-button" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button>
      <button className="primary-button" disabled={controlsDisabled} onClick={async()=>{if(await run('delete_cookies',{url,keys:snapshot.cookies.map(cookieKey),forgetSaved:false}))setConfirm(null);}}>Clear live cookies</button>
    </div>}
    <div className="cookie-scroll">
      {screen!=='list'&&<button className="text-button cookie-back" disabled={busy} onClick={back}><ArrowLeft size={14}/>Back to cookies</button>}
      {screen==='options'?<CookieOptions preferences={preferences} onChange={updatePreferences}/>:screen==='add'&&url?<CookieForm cookie={null} url={url} initialMode="none" busy={busy} onSave={save} onCancel={back} {...formOptions}/>:screen==='import'&&url?<ImportForm url={url} busy={busy} onImport={importCookies} onCancel={back}/>:screen==='export'&&url?<ExportForm cookies={snapshot.cookies} url={url} onCancel={back}/>:<>
        {loading?<p className="cookie-loading" role="status">Reading cookies…</p>:view==='live'&&!url?<EmptyState icon={<Cookie size={23}/>} heading="Open a website">Visit a website to inspect its live cookies. Saved cookies can still be managed here.</EmptyState>:view==='live'&&!cookies.length?<EmptyState icon={<Cookie size={23}/>} heading={query?'No matching cookies':'No cookies for this site'}>{query?'Try another name or domain.':'Add a cookie, import cookies, or refresh after the website sets cookies.'}</EmptyState>:view==='saved'&&!saved.length?<EmptyState icon={<ShieldCheck size={23}/>} heading={query?'No matching saved cookies':'Nothing set to restore'}>Choose an auto-restore mode when importing or editing a cookie.</EmptyState>:<div className="cookie-list">
          {view==='live'?cookies.map(cookie=>{
            const id=cookieId(cookie),saved=savedFor(cookie),open=!!editing&&cookieId(editing)===id,extra=rowInformation(cookie,preferences.extraInfo);
            return <article className={`cookie-row ${open?'cookie-row-open':''}`} key={id}>
              <div className="cookie-row-heading">
                <button className="cookie-expand" aria-expanded={open} aria-label={`Inspect ${cookie.name} ${cookie.path}`} disabled={busy} onClick={()=>setEditing(open?null:cookie)}><ChevronDown size={14} className={open?'expanded':''}/><strong>{cookie.name}</strong>{extra&&<span className="cookie-row-extra" title={extra}>{extra}</span>}</button>
                {saved?.enabled&&<span className="cookie-saved-label" title={restoreModes[saved.mode].description}><ShieldCheck size={12}/></span>}
                <IconButton label={`Edit ${cookie.name} ${cookie.path}`} disabled={controlsDisabled} onClick={()=>setEditing(cookie)}><span className="cookie-edit-label">Edit</span></IconButton>
                <IconButton label={`Delete ${cookie.name} ${cookie.path}`} disabled={controlsDisabled} onClick={()=>setConfirm(confirm===id?null:id)}><Trash2 size={14}/></IconButton>
              </div>
              {open&&editingMissing&&<p className="cookie-note" role="status">This cookie expired or was removed. Save to recreate it, or cancel to discard your draft.</p>}
              {open&&url&&<CookieForm key={id} inline cookie={editing} url={url} initialMode={saved?.mode||'none'} busy={busy} onSave={save} onCancel={()=>setEditing(null)} {...formOptions}/>}
              {confirm===id&&<div className="cookie-confirm"><p>Delete this cookie{saved?' and its saved copy':''}?</p><button className="secondary-button" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button><button className="primary-button" disabled={busy} onClick={()=>void remove(cookie)}>Delete cookie</button></div>}
            </article>;
          }):saved.map(entry=>{
            const id=cookieId(entry.cookie);
            return <article className={`saved-cookie-row ${entry.enabled?'':'paused'}`} key={id}>
              <div className="cookie-row-heading"><strong>{entry.cookie.name}</strong><IconButton label={`${entry.enabled?'Pause':'Enable'} restoration of ${entry.cookie.name} ${entry.cookie.path}`} disabled={controlsDisabled} onClick={()=>void manageSaved(entry,{enabled:!entry.enabled})}>{entry.enabled?<Pause size={14}/>:<Play size={14}/>}</IconButton><IconButton label={`Forget saved ${entry.cookie.name} ${entry.cookie.path}`} disabled={controlsDisabled} onClick={()=>setConfirm(confirm===id?null:id)}><Trash2 size={14}/></IconButton></div>
              <p className="cookie-row-meta">{entry.cookie.domain}{entry.cookie.path}</p>
              <label className="cookie-saved-mode">Restore policy<select aria-label={`Restore policy for ${entry.cookie.name} ${entry.cookie.path}`} value={entry.mode} disabled={controlsDisabled} onChange={e=>void manageSaved(entry,{mode:e.target.value as 'missing'|'exact'})}><option value="missing">Restore missing</option><option value="exact">Keep exact values</option></select></label>
              <p className="cookie-note">{entry.enabled?restoreModes[entry.mode].description:'Paused. This saved cookie will not be restored.'}</p>
              {confirm===id&&<div className="cookie-confirm"><p>Forget the saved copy? The live cookie will be kept.</p><button className="secondary-button" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button><button className="primary-button" disabled={busy} onClick={async()=>{await manageSaved(entry,{remove:true});setConfirm(null);}}>Forget copy</button></div>}
            </article>;
          })}
        </div>}
        {view==='saved'&&snapshot.saved.length>0&&<><button className="secondary-button cookie-restore-now" disabled={controlsDisabled} onClick={async()=>{if(await run('restore_cookies',{url}))b.notify('Saved cookies checked and restored where needed.');}}><RotateCcw size={14}/>Restore now</button><p className="cookie-note">Saved cookies survive restart and browser-data clearing. Pause or forget a saved copy to stop restoring it. Expired saved cookies are renewed when restored.</p></>}
      </>}
    </div>
    {showActions&&preferences.toolbarPosition==='bottom'&&actionBar}
    <footer className="cookie-status"><ShieldCheck size={13}/><span>{snapshot.saved.filter(s=>s.enabled).length} saved {snapshot.saved.filter(s=>s.enabled).length===1?'cookie':'cookies'} enabled{snapshot.restoredCount?` · ${snapshot.restoredCount} restored`:''}</span>{snapshot.lastRestoredAt&&<time title={new Date(snapshot.lastRestoredAt*1000).toLocaleString('en-GB')}>Last restore {new Date(snapshot.lastRestoredAt*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</time>}</footer>
  </section>;
}
