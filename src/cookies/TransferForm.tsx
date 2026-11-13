import {useState} from 'react';
import {ChevronRight,Copy,Download,FileUp} from 'lucide-react';
import type {CookieRecord,RestoreMode} from './types';
import {restoreModes} from './types';
import {exportHeader,exportJson,exportNetscape,parseCookieImport} from './formats';
import {RestoreSelect} from './CookieForm';
import {hostname} from '../model';

export function ImportForm({url,busy,onImport,onCancel}:{url:string;busy:boolean;onImport:(cookies:CookieRecord[],mode:RestoreMode)=>Promise<boolean>;onCancel:()=>void}){
  const [text,setText]=useState('');const [mode,setMode]=useState<RestoreMode>('missing');const [error,setError]=useState('');
  const file=async(input:HTMLInputElement)=>{
    const selected=input.files?.[0];if(!selected)return;
    if(selected.size>1024*1024){setError('Import must be 1 MB or smaller.');input.value='';return;}
    try{setText(await selected.text());setError('');}catch{setError('Could not read this file.');}input.value='';
  };
  return <form className="cookie-form cookie-import-form" onSubmit={async e=>{e.preventDefault();setError('');try{await onImport(parseCookieImport(text,url),mode);}catch(e){setError((e as Error).message);}}}>
    <h2>Import cookies</h2>
    <p className="cookie-note">Paste JSON, Netscape, or a Cookie header for {hostname(url)}.</p>
    <textarea className="cookie-transfer-text" aria-label="Cookie import data" autoFocus spellCheck={false} autoComplete="off" rows={12} value={text} onChange={e=>{setText(e.target.value);setError('');}} placeholder="Paste cookies here"/>
    {error&&<p role="alert" className="cookie-error">{error}</p>}
    <button type="submit" disabled={busy||!text.trim()} className="primary-button cookie-import-submit">{busy?'Importing…':'Import cookies'}</button>
    <details className="cookie-options-disclosure"><summary>Import options <span>{restoreModes[mode].label}</span></summary>
      <RestoreSelect value={mode} onChange={setMode} disabled={busy}/>
      {mode!=='none'&&<p className="cookie-note">Saved cookies survive restart and browser-data clearing. Expired saved cookies are renewed; server-revoked sessions cannot be revived.</p>}
      <label className="secondary-button cookie-file-button"><FileUp size={14}/>Choose file<input type="file" accept=".json,.txt,.cookies,application/json,text/plain" aria-label="Choose cookie file" disabled={busy} onChange={e=>void file(e.currentTarget)}/></label>
    </details>
    <button type="button" disabled={busy} className="text-button cookie-transfer-cancel" onClick={onCancel}>Cancel</button>
  </form>;
}

type Format='json'|'netscape'|'header';
export function ExportForm({cookies,url,onCancel}:{cookies:CookieRecord[];url:string;onCancel:()=>void}){
  const [format,setFormat]=useState<Format>('json');const [message,setMessage]=useState('');const [preview,setPreview]=useState(false);
  const output=(selected:Format)=>selected==='json'?exportJson(cookies):selected==='netscape'?exportNetscape(cookies):exportHeader(cookies);
  const text=output(format);
  const copy=async(selected:Format)=>{
    setFormat(selected);
    try{await navigator.clipboard.writeText(output(selected));setMessage('Copied to clipboard.');}
    catch{setMessage('Clipboard unavailable. Select the text below and copy it.');setPreview(true);}
  };
  const download=()=>{
    const link=document.createElement('a');const blob=URL.createObjectURL(new Blob([text],{type:format==='json'?'application/json':'text/plain'}));
    link.href=blob;link.download=`cookies-${hostname(url)}.${format==='json'?'json':'txt'}`;link.click();setTimeout(()=>URL.revokeObjectURL(blob),10000);setMessage('Export download requested.');
  };
  return <section className="cookie-form"><h2>Export cookies</h2><p className="cookie-note">Choose a format to copy {cookies.length} {cookies.length===1?'cookie':'cookies'} to the clipboard.</p>
    <div className="cookie-export-formats">{([['json','JSON','All cookie attributes'],['netscape','Netscape','cookies.txt; SameSite omitted'],['header','Header String','Names and values only; attributes omitted']] as const).map(([value,label,description])=><button type="button" key={value} aria-label={`Copy as ${label}`} onClick={()=>void copy(value)}><Copy size={17}/><span><strong>{label}</strong><small>{description}</small></span><ChevronRight size={16}/></button>)}</div>
    {message&&<p className="cookie-note" role="status">{message}</p>}
    <p className="cookie-note">Exports include private cookie values. Only share them with people you trust.</p>
    <details className="cookie-options-disclosure" open={preview} onToggle={e=>setPreview(e.currentTarget.open)}><summary>Preview and download</summary>
      <label className="cookie-field">Format<select aria-label="Cookie export format" value={format} onChange={e=>{setFormat(e.target.value as Format);setMessage('');}}><option value="json">Cookie-Editor JSON</option><option value="netscape">Netscape cookies.txt</option><option value="header">Header String</option></select></label>
      {format!=='json'&&<p className="cookie-note">{format==='netscape'?'Netscape format cannot retain SameSite settings.':'Header String contains only names and values. Domain, path, expiry, and security attributes are omitted.'}</p>}
      <label className="cookie-field">Exported data<textarea aria-label="Exported cookie data" readOnly rows={10} spellCheck={false} value={text} onFocus={e=>e.target.select()}/></label>
      <div className="cookie-export-actions"><button className="secondary-button" onClick={()=>void copy(format)}><Copy size={14}/>Copy</button><button className="secondary-button" onClick={download}><Download size={14}/>Download</button></div>
    </details>
    <button className="secondary-button cookie-transfer-cancel" onClick={onCancel}>Done</button>
  </section>;
}
