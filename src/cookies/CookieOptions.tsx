import {useEffect,useState} from 'react';
import type {CookieRecord} from './types';

const infoLabels={nothing:'Nothing',value:'Value',domain:'Domain',path:'Path',expiry:'Expiration',sameSite:'SameSite',hostOnly:'Host only',session:'Session',secure:'Secure',httpOnly:'HttpOnly'};
type ExtraInfo=keyof typeof infoLabels;
interface CookiePreferences {advanced:boolean;extraInfo:ExtraInfo;toolbarPosition:'top'|'bottom'}
const preferenceKey='mxplorer.cookies.options.v1';
const defaults:CookiePreferences={advanced:false,extraInfo:'nothing',toolbarPosition:'bottom'};

export function useCookiePreferences(){
  const [preferences,setPreferences]=useState<CookiePreferences>(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(preferenceKey)||'null');
      if(!saved||typeof saved!=='object')return defaults;
      return {advanced:saved.advanced===true,extraInfo:Object.hasOwn(infoLabels,saved.extraInfo)?saved.extraInfo:'nothing',toolbarPosition:saved.toolbarPosition==='top'?'top':'bottom'};
    }catch{return defaults;}
  });
  useEffect(()=>{try{localStorage.setItem(preferenceKey,JSON.stringify(preferences));}catch{/* Preferences are optional when storage is unavailable. */}},[preferences]);
  return {preferences,updatePreferences:(patch:Partial<CookiePreferences>)=>setPreferences(current=>({...current,...patch}))};
}

export function rowInformation(cookie:CookieRecord,field:ExtraInfo):string{
  if(field==='nothing')return '';
  if(field==='expiry')return cookie.session?'End of session':cookie.expirationDate?new Date(cookie.expirationDate*1000).toLocaleString('en-GB'):'Not set';
  if(field==='sameSite')return cookie.sameSite==='no_restriction'?'None':cookie.sameSite==='unspecified'?'Browser default':cookie.sameSite;
  const value=cookie[field];
  return typeof value==='boolean'?`${infoLabels[field]}: ${value?'Yes':'No'}`:value||'(empty)';
}

export default function CookieOptions({preferences,onChange}:{preferences:CookiePreferences;onChange:(patch:Partial<CookiePreferences>)=>void}){
  return <section className="cookie-form"><h2>Cookie editor options</h2>
    <label className="cookie-option-check"><input type="checkbox" checked={preferences.advanced} onChange={e=>onChange({advanced:e.target.checked})}/>Show advanced fields</label>
    <p className="cookie-note">Show domain, path, expiration, and security settings when editing. Hidden attributes are preserved.</p>
    <label className="cookie-field">Extra row information<select aria-label="Extra row information" value={preferences.extraInfo} onChange={e=>onChange({extraInfo:e.target.value as ExtraInfo})}>{Object.entries(infoLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    {preferences.extraInfo==='value'&&<p className="cookie-note">Cookie values will be visible in the list.</p>}
    <label className="cookie-field">Action bar position<select aria-label="Action bar position" value={preferences.toolbarPosition} onChange={e=>onChange({toolbarPosition:e.target.value as 'top'|'bottom'})}><option value="bottom">Bottom</option><option value="top">Top</option></select></label>
    <p className="cookie-note">These display preferences are saved on this device. Cookie values are kept separately.</p>
  </section>;
}
