import {useRef,useState} from 'react';
import {Copy} from 'lucide-react';
import type {CookieKey,CookieRecord,RestoreMode,SameSite} from './types';
import {restoreModes} from './types';
import {validateCookie} from './formats';

export function RestoreSelect({value,onChange,disabled=false}:{value:RestoreMode;onChange:(mode:RestoreMode)=>void;disabled?:boolean}){
  return <label className="cookie-field">Auto-restore<select aria-label="Auto-restore mode" value={value} disabled={disabled} onChange={e=>onChange(e.target.value as RestoreMode)}>{Object.entries(restoreModes).map(([key,mode])=><option value={key} key={key}>{mode.label}</option>)}</select><small>{restoreModes[value].description}</small></label>;
}
export default function CookieForm({cookie,url,initialMode,busy,onSave,onCancel,inline=false,advanced=true,onAdvancedChange}:{cookie:CookieRecord|null;url:string;initialMode:RestoreMode;busy:boolean;onSave:(record:CookieRecord,mode:RestoreMode,original:CookieKey|null)=>Promise<boolean>;onCancel:()=>void;inline?:boolean;advanced?:boolean;onAdvancedChange?:(value:boolean)=>void}){
  const [record,setRecord]=useState<CookieRecord>(()=>cookie||{name:'',value:'',domain:new URL(url).hostname,path:'/',hostOnly:true,secure:url.startsWith('https:'),httpOnly:false,sameSite:'lax',session:true,expirationDate:null});
  const [mode,setMode]=useState(initialMode);const [error,setError]=useState('');
  const valueField=useRef<HTMLTextAreaElement>(null);const [copyMessage,setCopyMessage]=useState('');
  const [expiry,setExpiry]=useState(()=>cookie?.expirationDate?new Date(cookie.expirationDate*1000).toISOString().slice(0,19):'');
  const [expiryChanged,setExpiryChanged]=useState(false);
  const patch=<K extends keyof CookieRecord>(key:K,value:CookieRecord[K])=>setRecord(r=>({...r,[key]:value}));
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();setError('');
    try{
      const normalized=validateCookie({...record,expirationDate:record.session?null:expiryChanged?(expiry?Date.parse(`${expiry}Z`)/1000:null):record.expirationDate},url);
      await onSave(normalized,mode,cookie);
    }catch(e){setError((e as Error).message);}
  };
  return <form className={`cookie-form ${inline?'cookie-inline-form':''}`} onSubmit={submit}>
    {!inline&&<h2>{cookie?'Edit cookie':'Add cookie'}</h2>}
    {inline&&<p className="cookie-inline-summary">{record.domain}{record.path} · {record.session?'End of session':'Persistent cookie'}</p>}
    <label className="cookie-field">Name<input autoFocus required autoComplete="off" spellCheck={false} maxLength={1024} value={record.name} onChange={e=>patch('name',e.target.value)}/></label>
    <label className="cookie-field">Value<textarea ref={valueField} aria-label="Cookie value" autoComplete="off" spellCheck={false} rows={3} value={record.value} onChange={e=>{patch('value',e.target.value);setCopyMessage('');}}/></label>
    <div className="cookie-value-actions"><button type="button" className="text-button cookie-copy-value" aria-label="Copy cookie value" onClick={async()=>{try{await navigator.clipboard.writeText(record.value);setCopyMessage('Value copied.');}catch{valueField.current?.focus();valueField.current?.select();setCopyMessage('Clipboard unavailable. Copy the selected value.');}}}><Copy size={12}/>Copy value</button>
    {onAdvancedChange&&<button type="button" className="text-button cookie-advanced-toggle" onClick={()=>onAdvancedChange(!advanced)}>{advanced?'Hide advanced fields':'Show advanced fields'}</button>}</div>
    {copyMessage&&<p className="cookie-note" role="status">{copyMessage}</p>}
    {advanced&&<><div className="cookie-field-grid"><label className="cookie-field">Domain<input required autoComplete="off" spellCheck={false} value={record.domain} onChange={e=>patch('domain',e.target.value)}/></label><label className="cookie-field">Path<input required autoComplete="off" spellCheck={false} value={record.path} onChange={e=>patch('path',e.target.value)}/></label></div>
    <div className="cookie-checkboxes">{([['secure','Secure'],['httpOnly','HttpOnly'],['hostOnly','Host only'],['session','Session cookie']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={record[key]} onChange={e=>patch(key,e.target.checked)}/>{label}</label>)}</div>
    {!record.session&&<label className="cookie-field">Expires (UTC)<input type="datetime-local" step="1" required aria-label="Cookie expiry UTC" value={expiry} onChange={e=>{setExpiry(e.target.value);setExpiryChanged(true);}}/></label>}
    <label className="cookie-field">SameSite<select aria-label="SameSite" value={record.sameSite} onChange={e=>patch('sameSite',e.target.value as SameSite)}><option value="lax">Lax</option><option value="strict">Strict</option><option value="no_restriction">None (requires Secure)</option><option value="unspecified">Browser default</option></select></label></>}
    <RestoreSelect value={mode} onChange={setMode} disabled={busy}/>
    {mode!=='none'&&<p className="cookie-note">Saved locally with Windows encryption. If the saved expiry passes, restoration renews it. Session cookies remain session cookies.</p>}
    {error&&<p className="cookie-error" role="alert">{error}</p>}
    <div className="cookie-form-actions"><button type="button" disabled={busy} className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={busy} type="submit">{busy?'Saving…':'Save cookie'}</button></div>
  </form>;
}
