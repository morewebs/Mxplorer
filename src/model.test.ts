import { describe, expect, it } from 'vitest';
import { resolveAddress, loadData, recordVisit, closeTab, createTab, defaults, applyTabUpdate } from './model';

describe('omnibox', () => {
  it('normalizes addresses and searches phrases', () => {
    expect(resolveAddress('example.com', 'duckduckgo')).toBe('https://example.com/');
    expect(resolveAddress('http://localhost:8080/test', 'google')).toBe('http://localhost:8080/test');
    expect(resolveAddress('localhost:1420', 'google')).toBe('http://localhost:1420/');
    expect(resolveAddress('why is the sky blue?', 'duckduckgo')).toBe('https://duckduckgo.com/?q=why%20is%20the%20sky%20blue%3F');
    expect(resolveAddress('mxplorer://history', 'google')).toBe('mxplorer://history');
  });
  it('never treats executable or local protocols as navigable addresses', () => {
    for (const input of ['javascript:alert(1)', 'file:///C:/secrets', 'tauri://localhost', 'data:text/html,hi']) {
      expect(resolveAddress(input, 'google')).toMatch(/^https:\/\/www.google.com\/search\?q=/);
    }
  });
  it('supports hostnames with ports and IPv6 development servers', () => {
    expect(resolveAddress('example.com:8080/path','google')).toBe('https://example.com:8080/path');
    expect(resolveAddress('127.0.0.1:8080','google')).toBe('http://127.0.0.1:8080/');
    expect(resolveAddress('[::1]:8080/test','google')).toBe('http://[::1]:8080/test');
    expect(resolveAddress('LOCALHOST:8080','google')).toBe('http://localhost:8080/');
    expect(resolveAddress('localhost:99999','google')).toContain('google.com/search?q=');
  });
});
describe('persistent browser data', () => {
  it('recovers corrupted and malformed state', () => {
    expect(loadData('{')).toEqual(defaults());
    const data = loadData(JSON.stringify({ bookmarks: [null, {url: 'javascript:bad',title:'bad'}], settings: { engine: 'bogus', restoreSession: 'no' }, session: [] }));
    expect(data.bookmarks).toEqual([]);
    expect(data.settings.engine).toBe('duckduckgo');
    expect(data.settings.restoreSession).toBe(true);
  });
  it('deduplicates consecutive visits and caps history', () => {
    const one = recordVisit([], {url:'https://example.com/',title:'Example'}, 100);
    expect(recordVisit(one, {url:'https://example.com/',title:'Updated'}, 200)).toEqual([{url:'https://example.com/',title:'Updated',visitedAt:200}]);
    expect(recordVisit(one, {url:'mxplorer://newtab',title:'Home'}, 300)).toEqual(one);
    expect(recordVisit(Array.from({length:2000}, (_,i)=>({url:`https://site${i}.com`,title:'Site',visitedAt:i})), {url:'https://new.com',title:'New'}, 9999)).toHaveLength(2000);
  });
});
describe('tab lifecycle', () => {
  it('selects a neighbour and always keeps a tab open', () => {
    const a=createTab(), b=createTab();
    const next = closeTab([a,b], a.id, a.id);
    expect(next.tabs).toEqual([b]); expect(next.activeId).toBe(b.id);
    const last = closeTab([b], b.id, b.id);
    expect(last.tabs).toHaveLength(1); expect(last.tabs[0].url).toBe('mxplorer://newtab');
  });
  it('keeps current selection when closing a background tab', () => {
    const a=createTab(), b=createTab(), c=createTab();
    expect(closeTab([a,b,c],c.id,a.id).activeId).toBe(a.id);
  });
  it('ignores late guest navigation events after navigating home', () => {
    const tab=createTab();
    expect(applyTabUpdate([tab],{id:tab.id,url:'https://old-page.com/',loading:false})).toEqual([tab]);
    const remote=createTab('https://example.com/');
    expect(applyTabUpdate([remote],{id:remote.id,url:'https://next.com/',canGoBack:true})[0].url).toBe('https://next.com/');
    expect(applyTabUpdate([remote],{id:remote.id,url:'file:///secret'})).toEqual([remote]);
  });
});
