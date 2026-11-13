import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const fixture={name:'demo',value:'synthetic-secret',domain:'example.com',path:'/',secure:true,httpOnly:true,hostOnly:true,sameSite:'lax',session:true,expirationDate:null};
test.beforeEach(async({page})=>{
  await page.route('https://**/favicon.ico',route=>route.abort());
  await page.route('**/src/native.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const desktop=true;
    const state={cookies:[${JSON.stringify(fixture)}],saved:[],lastRestoredAt:null,restoredCount:0,error:null};
    globalThis.__cookieCalls=[];
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
test('lists HttpOnly cookies with masked values and supports explicit reveal',async({page})=>{
  const panel=page.getByRole('region',{name:'Cookie editor',exact:true});
  await expect(panel.getByText('demo',{exact:true})).toBeVisible();
  await expect(panel.getByText('synthetic-secret',{exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'Reveal demo /',exact:true}).click();
  await expect(panel.getByText('synthetic-secret',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Hide demo /',exact:true}).click();
  await panel.getByRole('button',{name:'Inspect demo /',exact:true}).click();
  await expect(panel.getByText('End of session',{exact:true})).toBeVisible();
  await panel.screenshot({path:'test-results/cookie-editor.png'});
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
  await page.getByLabel('Auto-restore mode',{exact:true}).selectOption('missing');
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  await expect(page.getByText('imported',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Export',exact:true}).click();
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
  await page.getByLabel('Choose cookie file',{exact:true}).setInputFiles({name:'cookies.txt',mimeType:'text/plain',buffer:Buffer.from('example.com\tFALSE\t/\tTRUE\t0\tfile_cookie\t\n')});
  await expect(page.getByText('1 cookie ready to import')).toBeVisible();
  await page.getByLabel('Auto-restore mode',{exact:true}).selectOption('exact');
  await page.getByRole('button',{name:'Import cookies',exact:true}).click();
  await expect(page.getByText('file_cookie',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
  const file=await downloaded;expect(file.suggestedFilename()).toBe('cookies-example.com.json');
  const exported=JSON.parse(await readFile((await file.path())!,'utf8'));
  expect(exported).toHaveLength(2);expect(exported.find((c:any)=>c.name==='file_cookie').value).toBe('');
});
