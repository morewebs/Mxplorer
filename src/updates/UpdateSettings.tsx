import {useState} from 'react';
import {ArrowDownToLine,Check,RefreshCw,RotateCw} from 'lucide-react';
import type {Browser} from '../useBrowser';
import {Dialog} from '../ui';
import type {UpdateChannel,Updates} from './useUpdates';
import './updates.css';

function bytes(value:number){return value<1000000?`${Math.ceil(value/1000)} KB`:`${(value/1000000).toFixed(1)} MB`;}
export default function UpdateSettings({updates:u,browser:b}:{updates:Updates;browser:Browser}){
  const {status:s}=u;
  const [channel,setChannel]=useState<UpdateChannel|null>(null);const [restart,setRestart]=useState(false);
  const busy=['checking','downloading','installing'].includes(s.phase);
  const available=!!s.availableVersion;
  const restartNow=async()=>{
    try{b.persistSession();setRestart(false);if(!await u.install())b.cancelUpdateRestart();}
    catch(error){b.notify(`Could not save your browser session: ${String(error)}`);}
  };
  return <section className="settings-section update-section" aria-label="Browser updates">
    <h2>Updates</h2>
    <div className="update-heading"><div><strong>Mxplorer {s.currentVersion}</strong><span className="update-channel-badge">{s.channel}</span><p>Checks at startup and every 15 minutes.</p></div><button className="secondary-button" disabled={!u.desktop||!s.installed||busy||s.phase==='ready'} onClick={()=>void u.check()}><RefreshCw size={14} className={s.phase==='checking'?'spinner-icon':''}/>{s.phase==='checking'?'Checking…':'Check for updates'}</button></div>
    {!u.desktop?<p className="update-explanation">Updates are available in the Windows app.</p>:!s.installed?<p className="update-explanation">This standalone build needs a one-time managed installation to enable built-in updates. Your existing browser data is kept. <a href="https://github.com/morewebs/Mxplorer/releases/latest" target="_blank" rel="noreferrer" onClick={event=>{event.preventDefault();b.newTab('https://github.com/morewebs/Mxplorer/releases/latest');}}>Get the update-enabled installer</a></p>:<>
      <div className="setting-row update-channel-row"><div><strong>Update channel</strong><p>{s.channel==='stable'?'Stable releases, published when a version is ready.':'Nightly builds after each successful commit to main. These may contain unfinished changes.'}</p></div><select aria-label="Update channel" value={s.channel} disabled={busy} onChange={event=>{if(event.target.value!==s.channel)setChannel(event.target.value as UpdateChannel);}}><option value="stable">Stable</option><option value="nightly">Nightly</option></select></div>
      {s.phase==='idle'&&s.lastCheckedAt&&<p className="update-check-result" role="status"><Check size={14}/>You’re up to date.</p>}
      {available&&<div className="update-available">
        <div className="update-release-line"><strong>{s.phase==='ready'?'Ready to restart':s.phase==='installing'?'Installing update…':s.phase==='downloading'?'Downloading update…':'Update available'}</strong><span>{s.availableVersion}</span></div>
        {s.releaseNotes&&<details className="update-release-notes" open><summary>Release notes</summary><p>{s.releaseNotes}</p></details>}
        {s.downloadBytes!==null&&<p className="update-download-size">{s.delta?`Incremental download: ${bytes(s.downloadBytes)}`:`Download: ${bytes(s.downloadBytes)}`}{s.delta&&s.fullBytes!==null?` · full package ${bytes(s.fullBytes)}`:''}</p>}
        {s.phase==='downloading'&&<div className="update-progress" role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.progress??0}><div style={{width:`${Math.min(100,Math.max(0,s.progress??0))}%`}}/><span>{s.progress??0}%</span></div>}
        {s.phase==='ready'?<button className="primary-button" onClick={()=>setRestart(true)}><RotateCw size={14}/>Restart to update</button>:s.phase!=='downloading'&&s.phase!=='installing'&&<button className="primary-button" disabled={busy} onClick={()=>void u.download()}><ArrowDownToLine size={14}/>Download update</button>}
        <p className="update-explanation">Downloads only changed data when a delta is available. A full package is used if needed. Mxplorer restarts only when you choose.</p>
      </div>}
    </>}
    {s.error&&<p className="update-error" role="alert">{s.error}</p>}
    {channel&&<Dialog title="Switch update channel?" onClose={()=>setChannel(null)}><p className="dialog-copy">{channel==='nightly'?'Nightly receives a new build after each successful commit to main and may be less reliable.':'Stable receives tested version releases.'} Switching channels may install an earlier version. Your browser data is kept.</p><div className="dialog-actions"><button className="secondary-button" onClick={()=>setChannel(null)}>Cancel</button><button className="primary-button" onClick={()=>{const next=channel;setChannel(null);void u.changeChannel(next);}}>Switch to {channel}</button></div></Dialog>}
    {restart&&<Dialog title="Restart Mxplorer?" onClose={()=>setRestart(false)}><p className="dialog-copy">Mxplorer will close briefly and reopen to finish the update. Your browser session will be saved first.</p><div className="dialog-actions"><button className="secondary-button" onClick={()=>setRestart(false)}>Not now</button><button className="primary-button" onClick={()=>void restartNow()}>Restart and update</button></div></Dialog>}
  </section>;
}
