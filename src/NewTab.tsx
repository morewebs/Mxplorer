import {useState} from 'react';
import {ArrowRight,ChevronRight,Plus,Search,Settings2,X} from 'lucide-react';
import type {Browser} from './useBrowser';
import {engines,hostname,isWeb} from './model';
import {Dialog,IconButton,Mark,SiteIcon} from './ui';

export default function NewTab({browser:b}:{browser:Browser}){
  const [search,setSearch]=useState('');const [editing,setEditing]=useState(false);const [adding,setAdding]=useState(false);
  const [name,setName]=useState('');const [url,setUrl]=useState('');const [error,setError]=useState('');
  const recent=b.data.history.filter((v,i,all)=>all.findIndex(a=>a.url===v.url)===i).slice(0,4);
  const addShortcut=(event:React.FormEvent)=>{
    event.preventDefault();let address='';const value=url.trim();
    try{address=new URL(/^https?:\/\//i.test(value)?value:`${/^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value)?'http':'https'}://${value}`).href;}catch{/* show validation below */}
    if(!isWeb(address)||/\s/.test(value)||(!hostname(address).includes('.')&&!/^(localhost|\[::1\])$/.test(hostname(address)))){setError('Enter a website address, such as example.com.');return;}
    if(b.data.shortcuts.some(s=>s.url===address)){setError('This shortcut already exists.');return;}
    b.updateData(d=>({...d,shortcuts:[...d.shortcuts,{title:name.trim()||hostname(address),url:address}].slice(0,8)}));
    setAdding(false);setName('');setUrl('');setError('');
  };
  return <div className="newtab-page">
    <div className="newtab-center">
      <div className="brand-lockup"><Mark size={48}/><h1>Mxplorer</h1></div>
      <form className="home-search" onSubmit={e=>{e.preventDefault();if(search.trim())b.go(search);}}><Search size={20}/><input aria-label="Search the web" placeholder={`Search with ${engines[b.data.settings.engine].name} or enter address`} value={search} onChange={e=>setSearch(e.target.value)}/><button aria-label="Search" type="submit" disabled={!search.trim()}><ArrowRight size={19}/></button></form>
      <div className="shortcut-grid">{b.data.shortcuts.map(site=><div className="shortcut" key={site.url}><button className="shortcut-link" onClick={()=>b.go(site.url)} title={site.url}><SiteIcon url={site.url} title={site.title} large/><span>{site.title}</span></button>{editing&&<IconButton className="remove-shortcut" label={`Remove ${site.title}`} onClick={()=>b.updateData(d=>({...d,shortcuts:d.shortcuts.filter(s=>s.url!==site.url)}))}><X size={12}/></IconButton>}</div>)}{b.data.shortcuts.length<8&&<button className="shortcut shortcut-add" onClick={()=>{setError('');setAdding(true);}}><span className="add-tile"><Plus size={20}/></span><span>Add shortcut</span></button>}</div>
      {recent.length>0&&<section className="recent-section"><div className="section-heading"><h2>Recent pages</h2><button className="text-button" onClick={()=>b.openPage('history')}>History<ChevronRight size={14}/></button></div><div className="recent-grid">{recent.map(site=><button className="recent-link" key={site.url} onClick={()=>b.go(site.url)}><SiteIcon url={site.url} title={site.title}/><span><strong>{site.title}</strong><small>{hostname(site.url)}</small></span><ArrowRight size={14}/></button>)}</div></section>}
    </div>
    <button className={`customise-shortcuts text-button ${editing?'selected':''}`} onClick={()=>setEditing(!editing)}><Settings2 size={14}/>{editing?'Done':'Edit shortcuts'}</button>
    {adding&&<Dialog title="Add shortcut" onClose={()=>setAdding(false)}><form onSubmit={addShortcut} className="dialog-form"><label>Name<input autoFocus maxLength={40} placeholder="Website name" value={name} onChange={e=>setName(e.target.value)}/></label><label>Website address<input required placeholder="example.com" value={url} onChange={e=>setUrl(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setAdding(false)}>Cancel</button><button className="primary-button" type="submit">Add shortcut</button></div></form></Dialog>}
  </div>;
}
