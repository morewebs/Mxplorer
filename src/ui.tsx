import {useState} from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Globe2, X } from 'lucide-react';
import { hostname } from './model';

export function IconButton({label,children,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;children:ReactNode}) {
  return <button type="button" aria-label={label} title={label} className={`icon-button ${className}`} {...props}>{children}</button>;
}
export function Mark({size=28}:{size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M5 30V10h4l11 14 11-14h4v20h-5V19L20 32 10 19v11z" fill="currentColor"/></svg>;
}
export function SiteIcon({url,title,large=false}:{url:string;title?:string;large?:boolean}) {
  const [failed,setFailed]=useState(false);const [loaded,setLoaded]=useState(false);
  const host=hostname(url); const letter=(title||host).replace(/^www\./,'').charAt(0).toUpperCase();
  return <span className={`site-icon ${large?'large':''}`} aria-hidden="true"><span style={{visibility:loaded?'hidden':'visible'}}>{letter||<Globe2 size={15}/>}</span>{!failed&&<img src={`${new URL(url).origin}/favicon.ico`} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)}/>}</span>;
}
export function EmptyState({icon,heading,children}:{icon:ReactNode;heading:string;children:ReactNode}) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{heading}</h3><p>{children}</p></div>;
}
export function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}} onKeyDown={e=>{if(e.key==='Escape')onClose();}}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><div className="dialog-heading"><h2>{title}</h2><IconButton label="Close dialog" onClick={onClose}><X size={18}/></IconButton></div>{children}</section></div>;
}
