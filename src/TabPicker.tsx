import {useEffect,useRef,useState} from 'react';
import {Check,Globe2,Search,X} from 'lucide-react';
import type {Browser} from './useBrowser';
import {hostname,isInternal,pageTitle} from './model';
import {IconButton,Mark} from './ui';
export default function TabPicker({browser:b,onClose}:{browser:Browser;onClose:()=>void}) {
  const [query,setQuery]=useState('');const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{input.current?.focus();},[]);
  const tabs=b.tabs.filter(t=>`${t.title} ${t.url}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="tab-picker" role="dialog" aria-label="Search open tabs" onKeyDown={e=>{if(e.target===input.current&&e.key==='Enter'&&tabs.length){e.preventDefault();b.setActiveId(tabs[0].id);onClose();}}}>
    <div className="tab-picker-search"><Search size={16}/><input ref={input} aria-label="Search open tabs" placeholder="Search open tabs" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>Esc</kbd></div>
    <div className="tab-picker-label">{tabs.length} open {tabs.length===1?'tab':'tabs'}</div>
    <div className="tab-picker-list">{tabs.map(tab=><div className={`tab-picker-row ${tab.id===b.activeId?'current':''}`} key={tab.id}><button onClick={()=>{b.setActiveId(tab.id);onClose();}}>{isInternal(tab.url)?<Mark size={17}/>:<Globe2 size={16}/>}<span>{tab.title}<small>{isInternal(tab.url)?pageTitle(tab.url):hostname(tab.url)}</small></span>{tab.id===b.activeId&&<Check size={14}/>}</button><IconButton label={`Close tab ${tab.title}`} onClick={()=>b.removeTab(tab.id)}><X size={13}/></IconButton></div>)}</div>
    {!tabs.length&&<p className="tab-picker-empty">No tabs match “{query}”.</p>}
  </section>;
}
