import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const fixture={name:'demo',value:'synthetic-secret',domain:'example.com',path:'/',secure:true,httpOnly:true,hostOnly:true,sameSite:'lax',session:true,expirationDate:null};
test.beforeEach(async({page})=>{
  await page.route('https://**/favicon.ico',route=>route.abort());
  await page.route('**/src/native.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const desktop=true;
    const state={cookies:[${JSON.stringify(fixture)}],saved:[],lastRestoredAt:null,restoredCount:0,error:null};
    globalThis.__cookieCalls=[];
    globalThis.__expireCookies=()=>{state.cookies=[];};
    const id=c=>JSON.stringify([c.name,c.domain,c.path,c.hostOnly]);
    export async function command(name,args={}){
      globalThis.__cookieCalls.push({name,args:structuredClone(args)});
      if(name==='get_cookies')return structuredClone({...state,cookies:args.url?state.cookies.filter(c=>new URL(args.url).hostname===(c.domain.startsWith('.')?c.domain.slice(1):c.domain)):[]});
      if(name==='save_cookies'){
        if(args.original){state.cookies=state.cookies.filter(c=>id(c)!==id(args.original));state.saved=state.saved.filter(s=>id(s.cookie)!==id(args.original));}
        for(const cookie of args.cookies){state.cookies=[...state.cookies.filter(c=>id(c)!==id(cookie)),cookie];state.saved=state.saved.filter(s=>id(s.cookie)!==id(cookie));if(args.mode!=='none')state.saved.push({cookie,mode:args.mode,enabled:true,savedAt:2000000000,renewalSeconds:2592000});}
      }else if(name==='set_saved_cookie'){
        state.saved=state.saved.filter(s=>!(args.remove&&id(s.cookie)===id(args.key))).map(s=>id(s.cookie)===id(args.key)?{...s,...(args.mode?{mode:args.mode}:{}),...(typeof args.enabled==='boolean'?{enabled:args.enabled}:{})}:s);
      }else if(name==='delete_cookies'){
        state.cookies=state.cookies.filter(c=>!args.keys.some(k=>id(k)===id(c)));
        if(args.forgetSaved)state.saved=state.saved.filter(s=>!args.keys.some(k=>id(k)===id(s.cookie)));
      }else if(name==='restore_cookies'){state.restoredCount++;state.lastRestoredAt=2000000000;}
      if(name.includes('cookies')||name==='set_saved_cookie')return structuredClone(state);
    }
    export async function onNative(){return()=>{};}
  `}));
  await page.goto('/');
  await page.getByRole('textbox',{name:'Address bar',exact:true}).fill('https://example.com/');
  await page.getByRole('textbox',{name:'Address bar',exact:true}).press('Enter');
  await page.getByRole('button',{name:'Cookies',exact:true}).click();
  await expect(page.getByRole('region',{name:'Cookie editor',exact:true})).toBeVisible();
});
test('keeps values out of compact rows and opens editable fields inline',async({page})=>{
  const panel=page.getByRole('region',{name:'Cookie editor',exact:true});
  await expect(panel.getByText('demo',{exact:true})).toBeVisible();
  await expect(panel.getByText('synthetic-secret',{exact:true})).toHaveCount(0);
  await expect(panel.getByRole('textbox',{name:'Cookie value',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await expect(panel.getByRole('textbox',{name:'Cookie value',exact:true})).toHaveValue('synthetic-secret');
  await expect(panel.locator('.cookie-row').getByRole('button',{name:'Save cookie',exact:true})).toBeVisible();
  await expect(panel.locator('.cookie-inline-summary')).toContainText('End of session');
  await panel.screenshot({path:'test-results/cookie-editor.png'});
});

test('simple inline editing preserves hidden security attributes and copies the value',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await expect(page.getByLabel('Domain',{exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Cookie value',exact:true}).fill('inline%20value=a');
  await page.getByRole('button',{name:'Copy cookie value',exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('inline%20value=a');
  await page.getByRole('button',{name:'Save cookie',exact:true}).click();
  await page.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await page.getByRole('button',{name:'Show advanced fields',exact:true}).click();
  await expect(page.getByLabel('HttpOnly',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Secure',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Host only',{exact:true})).toBeChecked();
  await expect(page.getByLabel('SameSite',{exact:true})).toHaveValue('lax');
  await expect(page.getByLabel('Domain',{exact:true})).toHaveValue('example.com');
});

test('display preferences survive reopening without storing cookie values',async({page})=>{
  await page.getByRole('button',{name:'Cookie editor options',exact:true}).click();
  await page.getByLabel('Show advanced fields',{exact:true}).check();
  await page.getByLabel('Extra row information',{exact:true}).selectOption('domain');
  await page.getByLabel('Action bar position',{exact:true}).selectOption('top');
  await page.getByRole('button',{name:'Back to cookies',exact:true}).click();
  await expect(page.locator('.cookie-row-extra')).toHaveText('example.com');
  await page.reload();
  await page.getByRole('button',{name:'Cookies',exact:true}).click();
  await page.getByRole('button',{name:'Cookie editor options',exact:true}).click();
  await expect(page.getByLabel('Show advanced fields',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Extra row information',{exact:true})).toHaveValue('domain');
  await expect(page.getByLabel('Action bar position',{exact:true})).toHaveValue('top');
  const storage=await page.evaluate(()=>JSON.stringify(localStorage));
  expect(storage).not.toContain('synthetic-secret');
});

test('action bar stays visible while scrolling a long cookie list at minimum window size',async({page})=>{
  await page.setViewportSize({width:880,height:620});
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie import data',exact:true}).fill(JSON.stringify(Array.from({length:50},(_,i)=>({...fixture,name:`long_list_${i}`}))));
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  const scroll=page.locator('.cookie-scroll');
  await scroll.evaluate(element=>{element.scrollTop=element.scrollHeight;});
  const toolbar=page.getByRole('toolbar',{name:'Cookie actions',exact:true});
  await expect(toolbar).toBeVisible();
  const box=await toolbar.boundingBox();
  expect(box!.y+box!.height).toBeLessThanOrEqual(620);
  await page.screenshot({path:'test-results/cookie-editor-minimum-window.png'});
  await expect(page.getByRole('button',{name:'Import',exact:true})).toBeInViewport();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await expect(page.getByRole('button',{name:'Copy as JSON',exact:true})).toBeVisible();
});

test('changing site discards an inline draft',async({page})=>{
  await page.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie value',exact:true}).fill('unsaved-private-value');
  const address=page.getByRole('textbox',{name:'Address bar',exact:true});
  await address.fill('https://example.net/');await address.press('Enter');
  await expect(page.getByRole('textbox',{name:'Cookie value',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'No cookies for this site'})).toBeVisible();
});

test('background cookie polling leaves an inline draft intact',async({page})=>{
  await page.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie value',exact:true}).fill('draft-not-yet-saved');
  const pollCount=()=>page.evaluate(()=>(globalThis as any).__cookieCalls.filter((call:any)=>call.name==='get_cookies').length);
  const initialCount=await pollCount();
  await expect.poll(pollCount,{timeout:5000}).toBeGreaterThan(initialCount);
  await expect(page.getByRole('textbox',{name:'Cookie value',exact:true})).toHaveValue('draft-not-yet-saved');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Cookie value',exact:true})).toHaveValue('synthetic-secret');
});

test('an expiring cookie does not discard a draft and saving recreates it',async({page})=>{
  await page.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie value',exact:true}).fill('draft-survives-expiry');
  await page.evaluate(()=>(globalThis as any).__expireCookies());
  await page.getByRole('button',{name:'Refresh cookies',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Cookie value',exact:true})).toHaveValue('draft-survives-expiry');
  await page.getByRole('button',{name:'Save cookie',exact:true}).click();
  await page.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Cookie value',exact:true})).toHaveValue('draft-survives-expiry');
});

test('simple value edits preserve the exact persistent expiration timestamp',async({page})=>{
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie import data',exact:true}).fill(JSON.stringify([{...fixture,name:'persistent',session:false,expirationDate:2000000037}]));
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  await page.getByRole('button',{name:'Inspect persistent /',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie value',exact:true}).fill('updated-persistent');
  await page.getByRole('button',{name:'Save cookie',exact:true}).click();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await page.getByText('Preview and download',{exact:true}).click();
  const exported=JSON.parse(await page.getByRole('textbox',{name:'Exported cookie data',exact:true}).inputValue());
  expect(exported.find((cookie:any)=>cookie.name==='persistent')).toMatchObject({expirationDate:2000000037,session:false,httpOnly:true,secure:true,value:'updated-persistent'});
});
test('edits cookie attributes and manages both saved restoration policies',async({page})=>{
  await page.getByRole('button',{name:'Edit demo /',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie value',exact:true}).fill('synthetic-updated');
  await page.getByLabel('Auto-restore mode',{exact:true}).selectOption('exact');
  await page.getByRole('button',{name:'Save cookie',exact:true}).click();
  await page.getByRole('tab',{name:/Saved for restore/}).click();
  await expect(page.getByLabel('Restore policy for demo /',{exact:true})).toHaveValue('exact');
  await page.getByLabel('Restore policy for demo /',{exact:true}).selectOption('missing');
  await page.getByRole('button',{name:'Pause restoration of demo /',exact:true}).click();
  await expect(page.getByText('Paused. This saved cookie will not be restored.')).toBeVisible();
  await page.getByRole('button',{name:'Enable restoration of demo /',exact:true}).click();
  await page.getByRole('button',{name:'Restore now',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.stringify((globalThis as any).__cookieCalls))).toContain('restore_cookies');
  const stored=await page.evaluate(()=>localStorage.getItem('mxplorer.browser.v1')||'');
  expect(stored).not.toContain('synthetic-updated');
});
test('imports JSON with selected policy and exports Netscape with HttpOnly',async({page})=>{
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie import data',exact:true}).fill(JSON.stringify([{...fixture,name:'imported'}]));
  await page.getByText('Import options',{exact:false}).click();
  await page.getByLabel('Auto-restore mode',{exact:true}).selectOption('missing');
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  await expect(page.getByText('imported',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await page.getByText('Preview and download',{exact:true}).click();
  const json=await page.getByRole('textbox',{name:'Exported cookie data',exact:true}).inputValue();
  expect(JSON.parse(json)).toHaveLength(2);
  await page.getByLabel('Cookie export format',{exact:true}).selectOption('netscape');
  await expect(page.getByRole('textbox',{name:'Exported cookie data',exact:true})).toContainText('#HttpOnly_example.com');
});
test('rejects an unrelated import before calling native mutation',async({page})=>{
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await page.getByRole('textbox',{name:'Cookie import data',exact:true}).fill(JSON.stringify([{...fixture,domain:'unrelated.com'}]));
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('must match the current website');
  const calls=await page.evaluate(()=>(globalThis as any).__cookieCalls.filter((c:any)=>c.name==='save_cookies'));
  expect(calls).toHaveLength(0);
});
test('individual delete forgets saved copy while live clearing retains it',async({page})=>{
  await page.getByRole('button',{name:'Edit demo /',exact:true}).click();
  await page.getByLabel('Auto-restore mode',{exact:true}).selectOption('missing');
  await page.getByRole('button',{name:'Save cookie',exact:true}).click();
  await page.getByRole('button',{name:'Clear live cookies',exact:true}).click();
  await expect(page.getByText('Clear all live cookies for this site? Enabled saved copies will return automatically.')).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Delete demo /',exact:true}).click();
  await page.getByRole('button',{name:'Delete cookie',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No cookies for this site'})).toBeVisible();
  const calls=await page.evaluate(()=>(globalThis as any).__cookieCalls.filter((c:any)=>c.name==='delete_cookies'));
  expect(calls[0].args.forgetSaved).toBe(true);
  await page.getByRole('tab',{name:/Saved for restore/}).click();
  await expect(page.getByRole('heading',{name:'Nothing set to restore'})).toBeVisible();
});
test('cookie sidebar remains open and changes scope when navigating to another website',async({page})=>{
  await expect(page.getByText('demo',{exact:true})).toBeVisible();
  const address=page.getByRole('textbox',{name:'Address bar',exact:true});
  await address.fill('https://example.net/');await address.press('Enter');
  await expect(page.getByRole('region',{name:'Cookie editor',exact:true})).toBeVisible();
  await expect(page.locator('.cookie-site')).toContainText('example.net');
  await expect(page.getByRole('heading',{name:'No cookies for this site'})).toBeVisible();
  await expect(page.getByText('demo',{exact:true})).toHaveCount(0);
});
test('imports a selected file and downloads a valid JSON export',async({page})=>{
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await page.getByText('Import options',{exact:false}).click();
  await page.getByLabel('Choose cookie file',{exact:true}).setInputFiles({name:'cookies.txt',mimeType:'text/plain',buffer:Buffer.from('example.com\tFALSE\t/\tTRUE\t0\tfile_cookie\t\n')});
  await expect(page.getByRole('textbox',{name:'Cookie import data',exact:true})).toHaveValue('example.com\tFALSE\t/\tTRUE\t0\tfile_cookie\t\n');
  await page.getByLabel('Auto-restore mode',{exact:true}).selectOption('exact');
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  await expect(page.getByText('file_cookie',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await page.getByText('Preview and download',{exact:true}).click();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
  const file=await downloaded;expect(file.suggestedFilename()).toBe('cookies-example.com.json');
  const exported=JSON.parse(await readFile((await file.path())!,'utf8'));
  expect(exported).toHaveLength(2);expect(exported.find((c:any)=>c.name==='file_cookie').value).toBe('');
});

test('pastes and imports cookies directly with restore missing enabled by default',async({page})=>{
  await page.setViewportSize({width:880,height:620});
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await expect(page.getByRole('button',{name:'Import cookies',exact:true})).toBeInViewport({ratio:1});
  await page.getByRole('textbox',{name:'Cookie import data',exact:true}).fill('pasted=one%20two; empty=');
  await page.getByRole('region',{name:'Cookie editor',exact:true}).screenshot({path:'test-results/cookie-import.png'});
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  await expect(page.getByText('pasted',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:/Saved for restore/}).click();
  await expect(page.getByLabel('Restore policy for pasted /',{exact:true})).toHaveValue('missing');
  await expect(page.getByLabel('Restore policy for empty /',{exact:true})).toHaveValue('missing');
});

test('export format buttons copy JSON, Netscape and Header String immediately',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await page.getByRole('button',{name:'Copy as JSON',exact:true}).click();
  expect(JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()))[0]).toMatchObject(fixture);
  await page.getByRole('button',{name:'Copy as Netscape',exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('#HttpOnly_example.com\tFALSE\t/\tTRUE\t0\tdemo\tsynthetic-secret');
  await page.getByRole('button',{name:'Copy as Header String',exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('demo=synthetic-secret');
  await page.getByRole('region',{name:'Cookie editor',exact:true}).screenshot({path:'test-results/cookie-export.png'});
});

test('clipboard rejection exposes selectable export text instead of losing the export',async({page})=>{
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))}}));
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await page.getByRole('button',{name:'Copy as Header String',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Exported cookie data',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Exported cookie data',exact:true})).toHaveValue('demo=synthetic-secret');
  await expect(page.getByRole('status').filter({hasText:'Clipboard unavailable'})).toBeVisible();
});
