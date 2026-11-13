import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.clock.install();
  await page.route('https://**/favicon.ico',route=>route.abort());
  await page.route('**/src/native.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const desktop=true;
    const state={currentVersion:'0.3.0',channel:'stable',installed:true,phase:'idle',progress:null,availableVersion:null,releaseNotes:null,downloadBytes:null,fullBytes:null,delta:false,error:null,lastCheckedAt:null,channelSwitch:false};
    const listeners=new Map();
    globalThis.__updateCalls=[];
    globalThis.__setUpdate=patch=>{Object.assign(state,patch);listeners.get('update-status')?.(structuredClone(state));};
    export async function onNative(name,handler){listeners.set(name,handler);return()=>listeners.delete(name);}
    export async function command(name,args={}){
      globalThis.__updateCalls.push({name,args});
      if(globalThis.__updateFail===name)throw new Error('Network unavailable. Try again later.');
      if(name==='set_update_channel'){Object.assign(state,{channel:args.channel,phase:'idle',availableVersion:null,channelSwitch:true});}
      if(name==='check_for_updates')Object.assign(state,{phase:'available',availableVersion:state.channel==='stable'?'0.3.1':'0.3.1-nightly.42.1',releaseNotes:'Faster navigation and cookie editor fixes.',delta:true,downloadBytes:420000,fullBytes:2500000,lastCheckedAt:1794560000});
      if(name==='download_update'){
        globalThis.__setUpdate({phase:'downloading',progress:37});
        return new Promise(resolve=>{globalThis.__finishUpdateDownload=()=>{globalThis.__setUpdate({phase:'ready',progress:100});resolve(structuredClone(state));};});
      }
      if(name==='install_update')globalThis.__setUpdate({phase:'installing'});
      if(['get_update_status','check_for_updates','set_update_channel','install_update'].includes(name))return structuredClone(state);
    }
  `}));
  await page.goto('/');
  const address=page.getByRole('textbox',{name:'Address bar',exact:true});
  await address.fill('mxplorer://settings');await address.press('Enter');
});

test('checks for updates and shows a smaller delta download with release notes',async({page})=>{
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await expect(page.getByRole('region',{name:'Browser updates',exact:true})).toContainText('0.3.1');
  await expect(page.getByText('Faster navigation and cookie editor fixes.',{exact:true})).toBeVisible();
  await expect(page.getByText(/420.*KB/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Browser update available',exact:true})).toBeVisible();
  await page.getByRole('region',{name:'Browser updates',exact:true}).screenshot({path:'test-results/browser-update-available.png'});
});

test('stages downloads, reports progress, and requires confirmation before restart',async({page})=>{
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await page.getByRole('button',{name:'Download update',exact:true}).click();
  await expect(page.getByRole('progressbar',{name:'Update download',exact:true})).toHaveAttribute('aria-valuenow','37');
  await expect(page.getByLabel('Update channel',{exact:true})).toBeDisabled();
  await page.evaluate(()=>(globalThis as any).__finishUpdateDownload());
  await page.getByRole('button',{name:'Restart to update',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Restart Mxplorer?',exact:true})).toBeVisible();
  const installs=()=>page.evaluate(()=>(globalThis as any).__updateCalls.filter((call:any)=>call.name==='install_update'));
  expect(await installs()).toHaveLength(0);
  await page.getByRole('button',{name:'Not now',exact:true}).click();
  expect(await installs()).toHaveLength(0);
  await page.getByRole('button',{name:'Restart to update',exact:true}).click();
  await page.getByRole('button',{name:'Restart and update',exact:true}).click();
  await expect.poll(installs).toHaveLength(1);
  const session=await page.evaluate(()=>JSON.parse(localStorage.getItem('mxplorer.browser.v1')||'{}').session);
  expect(session).toEqual([{url:'mxplorer://settings',title:'Settings'}]);
});

test('channel changes need an explicit choice and then check the selected feed',async({page})=>{
  await page.getByLabel('Update channel',{exact:true}).selectOption('nightly');
  await expect(page.getByRole('dialog',{name:'Switch update channel?',exact:true})).toBeVisible();
  const changes=()=>page.evaluate(()=>(globalThis as any).__updateCalls.filter((call:any)=>call.name==='set_update_channel'));
  expect(await changes()).toHaveLength(0);
  await page.getByRole('button',{name:'Switch to nightly',exact:true}).click();
  await expect(page.getByLabel('Update channel',{exact:true})).toHaveValue('nightly');
  await expect(page.getByRole('region',{name:'Browser updates',exact:true})).toContainText('0.3.1-nightly.42.1');
  expect((await changes())[0].args).toEqual({channel:'nightly'});
});

test('network errors leave a retry and do not claim an update was installed',async({page})=>{
  await page.evaluate(()=>(globalThis as any).__updateFail='check_for_updates');
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Network unavailable');
  await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeEnabled();
  await page.evaluate(()=>(globalThis as any).__updateFail='');
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download update',exact:true})).toBeVisible();
});

test('legacy executables explain the one-time managed install instead of offering a broken update',async({page})=>{
  await page.evaluate(()=>(globalThis as any).__setUpdate({installed:false}));
  await expect(page.getByRole('region',{name:'Browser updates',exact:true})).toContainText('one-time');
  await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeDisabled();
  await expect(page.getByRole('link',{name:'Get the update-enabled installer',exact:true})).toHaveAttribute('href','https://github.com/morewebs/Mxplorer/releases/latest');
});

test('an update event makes the chrome indicator available outside settings',async({page})=>{
  const address=page.getByRole('textbox',{name:'Address bar',exact:true});
  await address.fill('mxplorer://newtab');await address.press('Enter');
  await page.evaluate(()=>(globalThis as any).__setUpdate({phase:'available',availableVersion:'0.3.1'}));
  await page.getByRole('button',{name:'Browser update available',exact:true}).click();
  await expect(page.getByRole('region',{name:'Browser updates',exact:true})).toBeVisible();
});

test('startup and scheduled checks notify without downloading or restarting',async({page})=>{
  await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeEnabled();
  await page.clock.runFor(8000);
  await expect(page.getByRole('button',{name:'Download update',exact:true})).toBeVisible();
  await page.clock.runFor(15*60*1000);
  const calls=await page.evaluate(()=>(globalThis as any).__updateCalls.map((call:any)=>call.name));
  expect(calls.filter((name:string)=>name==='check_for_updates')).toHaveLength(2);
  expect(calls).not.toContain('download_update');expect(calls).not.toContain('install_update');
});

test('failure to save the session prevents the restart',async({page})=>{
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await page.getByRole('button',{name:'Download update',exact:true}).click();
  await page.evaluate(()=>(globalThis as any).__finishUpdateDownload());
  await page.getByRole('button',{name:'Restart to update',exact:true}).click();
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Storage full','QuotaExceededError');};});
  await page.getByRole('button',{name:'Restart and update',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Could not save your browser session'})).toBeVisible();
  expect(await page.evaluate(()=>(globalThis as any).__updateCalls.filter((call:any)=>call.name==='install_update'))).toHaveLength(0);
});

test('update restart restores tabs once without changing ordinary startup preferences',async({page})=>{
  await page.getByRole('switch',{name:'Continue where you left off',exact:true}).click();
  await page.keyboard.press('Control+t');
  const address=page.getByRole('textbox',{name:'Address bar',exact:true});
  await address.fill('https://example.com/');await address.press('Enter');
  await page.keyboard.press('Control+1');
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await page.getByRole('button',{name:'Download update',exact:true}).click();
  await page.evaluate(()=>(globalThis as any).__finishUpdateDownload());
  await page.getByRole('button',{name:'Restart to update',exact:true}).click();
  await page.getByRole('button',{name:'Restart and update',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('switch',{name:'Continue where you left off',exact:true})).toHaveAttribute('aria-checked','false');
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(1);
});
