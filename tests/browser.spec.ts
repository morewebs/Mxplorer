import { test, expect } from '@playwright/test';
const key='mxplorer.browser.v1';
test.beforeEach(async({page})=>{await page.route('https://**/favicon.ico',route=>route.abort());});

test('new tab presents real empty history and supports adding and removing shortcuts', async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Mxplorer'})).toBeVisible();
  await expect(page.locator('.recent-section')).toHaveCount(0);
  await page.getByRole('button',{name:'Add shortcut',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Example');
  await page.getByLabel('Website address').fill('example.com');
  await page.getByRole('button',{name:'Add shortcut',exact:true}).last().click();
  await expect(page.getByRole('button',{name:'Example',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit shortcuts'}).click();
  await page.getByRole('button',{name:'Remove Example',exact:true}).click();
  await expect(page.getByRole('button',{name:'Example',exact:true})).toHaveCount(0);
});
test('tabs can be opened, closed and restored with shortcuts',async({page})=>{
  await page.goto('/');
  await page.keyboard.press('Control+t');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+t');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Control+Tab');
  await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected','true');
});
test('search settings and bookmarks bar preference persist',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Mxplorer menu',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Search engine',{exact:true}).selectOption('google');
  await page.getByRole('switch',{name:'Show bookmarks bar'}).click();
  await expect(page.locator('.bookmarks-bar')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null')?.settings?.engine,key)).toBe('google');
  await page.reload();
  await page.getByRole('tab',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('Search engine',{exact:true})).toHaveValue('google');
  await expect(page.getByRole('switch',{name:'Show bookmarks bar'})).toHaveAttribute('aria-checked','false');
});
test('omnibox searches safely, bookmark persists and can be removed',async({page})=>{
  await page.goto('/');
  await page.getByRole('textbox',{name:'Address bar'}).fill('example.com');
  await page.getByRole('textbox',{name:'Address bar'}).press('Enter');
  await expect(page.getByRole('textbox',{name:'Address bar'})).toHaveValue('https://example.com/');
  await page.getByRole('button',{name:'Bookmark this page (Ctrl+D)',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove bookmark (Ctrl+D)',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Bookmarks',exact:true}).click();
  await expect(page.getByRole('complementary').getByRole('button',{name:'example.com example.com',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove example.com',exact:true}).click();
  await expect(page.getByRole('button',{name:'Bookmark this page (Ctrl+D)',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Address bar'}).fill('javascript:alert(1)');
  await page.getByRole('textbox',{name:'Address bar'}).press('Enter');
  await expect(page.getByRole('textbox',{name:'Address bar'})).toHaveValue('https://duckduckgo.com/?q=javascript%3Aalert(1)');
});
test('history can be searched and cleared with confirmation',async({page})=>{
  await page.addInitScript(({key})=>localStorage.setItem(key,JSON.stringify({history:[{title:'Example Domain',url:'https://example.com/',visitedAt:Date.now()},{title:'Wikipedia',url:'https://wikipedia.org/',visitedAt:Date.now()}]})),{key});
  await page.goto('/');
  await page.keyboard.press('Control+h');
  await page.getByRole('textbox',{name:'Search history'}).fill('wikipedia');
  await expect(page.getByRole('button',{name:/Wikipedia https/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Example Domain https/})).toHaveCount(0);
  await page.getByRole('button',{name:'Clear history',exact:true}).click();
  await expect(page.getByRole('button',{name:'Confirm clear'})).toBeVisible();
  await page.getByRole('button',{name:'Confirm clear'}).click();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A fresh start'})).toBeVisible();
});
test('clear data keeps bookmarks and requests explicit cookie choice',async({page})=>{
  await page.goto('/');
  await page.getByRole('textbox',{name:'Address bar'}).fill('example.com');await page.getByRole('textbox',{name:'Address bar'}).press('Enter');
  await page.keyboard.press('Control+d');
  await page.getByRole('button',{name:'Mxplorer menu',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Choose what to clear'}).click();
  await expect(page.getByRole('checkbox',{name:'Also clear cookies and cached site data'})).not.toBeChecked();
  await page.getByRole('button',{name:'Clear data',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('History and download list cleared.');
  await expect.poll(()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null')?.bookmarks?.length,key)).toBe(1);
});
test('monochrome new tab fits desktop without overflow',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Mxplorer'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mxplorer-newtab.png'});
});
test('tab arrow opens a searchable dropdown without changing page width',async({page})=>{
  await page.goto('/');
  await page.keyboard.press('Control+t');
  const before=await page.locator('.page-content').boundingBox();
  await page.getByRole('button',{name:'Search tabs',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Search open tabs',exact:true})).toBeVisible();
  expect((await page.locator('.page-content').boundingBox())?.width).toBe(before?.width);
  await page.getByRole('textbox',{name:'Search open tabs',exact:true}).fill('missing');
  await expect(page.getByText('No tabs match “missing”.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'All bookmarks',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bookmarks',exact:true})).toBeVisible();
});
test('address selection and bookmark bar shortcuts follow browser conventions',async({page})=>{
  await page.goto('/');
  const address=page.getByRole('textbox',{name:'Address bar'});
  await address.fill('example.com');await address.press('Enter');
  await address.click();
  expect(await address.evaluate((el:HTMLInputElement)=>el.selectionEnd!-el.selectionStart!)).toBe('https://example.com/'.length);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+b');
  await expect(page.locator('.bookmarks-bar')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+b');
  await expect(page.locator('.bookmarks-bar')).toBeVisible();
});
test('tab dropdown close buttons work with Enter and internal pages do not show phantom zoom',async({page})=>{
  await page.goto('/');await page.keyboard.press('Control+t');
  await page.getByRole('button',{name:'Search tabs',exact:true}).click();
  await page.getByRole('button',{name:'Close tab New tab',exact:true}).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('Escape');await page.keyboard.press('Control+Equal');
  await expect(page.locator('.address-zoom')).toHaveCount(0);
});
test('rapid address refocus preserves typed text and focus styling',async({page})=>{
  await page.goto('/');
  const address=page.getByRole('textbox',{name:'Address bar',exact:true});
  await address.focus();await address.blur();
  await address.fill('https://example.net/');
  // Wait beyond the previous 150ms deferred blur to reproduce a stale focus callback.
  await page.waitForTimeout(220);
  await expect(address).toHaveValue('https://example.net/');
  await expect(page.locator('.address-bar')).toHaveClass(/focused/);
});
