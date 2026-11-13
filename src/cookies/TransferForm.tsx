import {useState} from 'react';
import {Copy,Download,FileUp} from 'lucide-react';
import type {CookieRecord,RestoreMode} from './types';
import {exportJson,exportNetscape,parseCookieImport} from './formats';
import {RestoreSelect} from './CookieForm';
import {hostname} from '../model';

export function ImportForm({url,busy,onImport,onCancel}:{url:string;busy:boolean;onImport:(cookies:CookieRecord[],mode:RestoreMode)=>Promise<boolean>;onCancel:()=>void}){
  const [text,setText]=useState('');const [mode,setMode]=useState<RestoreMode>('missing');const [error,setError]=useState('');
  const parsed=(()=>{try{return text.trim()?parseCookieImport(text,url):null;}catch{return null;}})();
  const file=async(input:HTMLInputElement)=>{
    const selected=input.files?.[0];if(!selected)return;
    if(selected.size>1024*1024){setError('Import must be 1 MB or smaller.');input.value='';return;}
    try{setText(await selected.text());setError('');}catch{setError('Could not read this file.');}input.value='';
  };
  return <form className="cookie-form" onSubmit={async e=>{e.preventDefault();setError('');try{await onImport(parseCookieImport(text,url),mode);}catch(e){setError((e as Error).message);}}}>
    <h2>Import cookies</h2><p className="cookie-note">Paste Cookie-Editor JSON, a Netscape cookies.txt file, or a Cookie header. Only cookies for {hostname(url)} can be imported here.</p>
    <label className="cookie-field">Cookie data<textarea aria-label="Cookie import data" spellCheck={false} autoComplete="off" rows={10} value={text} onChange={e=>{setText(e.target.value);setError('');}} placeholder={'[{"name":"example","value":"…","domain":"'+hostname(url)+'","path":"/"}]'}/></label>
    <label className="secondary-button cookie-file-button"><FileUp size={14}/>Choose file<input type="file" accept=".json,.txt,.cookies,application/json,text/plain" aria-label="Choose cookie file" onChange={e=>void file(e.currentTarget)}/></label>
    {parsed&&<p className="cookie-import-count">{parsed.length} {parsed.length===1?'cookie':'cookies'} ready to import</p>}
    <RestoreSelect value={mode} onChange={setMode} disabled={busy}/>
    {mode!=='none'&&<p className="cookie-note">Saved copies survive browser-data clearing and restart. Expired saved cookies are renewed when restored; this cannot revive a session revoked by the website.</p>}
    {error&&<p role="alert" className="cookie-error">{error}</p>}
    <div className="cookie-form-actions"><button type="button" disabled={busy} className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" disabled={busy||!text.trim()} className="primary-button">{busy?'Importing…':'Import cookies'}</button></div>
  </form>;
}
export function ExportForm({cookies,url,onCancel}:{cookies:CookieRecord[];url:string;onCancel:()=>void}){
  const [format,setFormat]=useState<'json'|'netscape'>('json');const [message,setMessage]=useState('');
  const text=format==='json'?exportJson(cookies):exportNetscape(cookies);
  const copy=async()=>{try{await navigator.clipboard.writeText(text);setMessage('Copied to clipboard.');}catch{setMessage('Clipboard unavailable. Select the text below and copy it.');}};
  const download=()=>{const link=document.createElement('a');const blob=URL.createObjectURL(new Blob([text],{type:format==='json'?'application/json':'text/plain'}));link.href=blob;link.download=`cookies-${hostname(url)}.${format==='json'?'json':'txt'}`;link.click();setTimeout(()=>URL.revokeObjectURL(blob),10000);setMessage('Export download requested.');};
  return <section className="cookie-form"><h2>Export cookies</h2><p className="cookie-note">This export contains cookie values, including HttpOnly cookies. Keep it private.</p><label className="cookie-field">Format<select aria-label="Cookie export format" value={format} onChange={e=>{setFormat(e.target.value as typeof format);setMessage('');}}><option value="json">Cookie-Editor JSON</option><option value="netscape">Netscape cookies.txt</option></select></label>{format==='netscape'&&<p className="cookie-note">Netscape format cannot retain SameSite settings.</p>}<label className="cookie-field">Exported data<textarea aria-label="Exported cookie data" readOnly rows={13} spellCheck={false} value={text} onFocus={e=>e.target.select()}/></label>{message&&<p className="cookie-note" role="status">{message}</p>}<div className="cookie-export-actions"><button className="secondary-button" onClick={()=>void copy()}><Copy size={14}/>Copy</button><button className="secondary-button" onClick={download}><Download size={14}/>Download</button><button className="primary-button" onClick={onCancel}>Done</button></div></section>;
}
