import type { Bookmark, BrowserData, Engine, Tab, TabUpdate, Visit } from './types';

export const STORAGE_KEY = 'mxplorer.browser.v1';
export const HOME = 'mxplorer://newtab';
export const engines: Record<Engine, { name: string; search: string }> = {
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', search: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=' },
};
export const internalPages = ['newtab', 'history', 'bookmarks', 'downloads', 'settings'];
export function isInternal(url: string) { return internalPages.some(p => url === `mxplorer://${p}`); }
export function isWeb(url: string) { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } }
export function hostname(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
export function pageTitle(url: string) { return isInternal(url) ? (url === HOME ? 'New tab' : url.slice(11).replace(/^./, c => c.toUpperCase())) : hostname(url); }

export function resolveAddress(input: string, engine: Engine): string {
  const value = input.trim();
  if (!value) return HOME;
  if (isInternal(value)) return value;
  if (/^https?:\/\//i.test(value)) { try { return new URL(value).href; } catch { /* search malformed addresses */ } }
  if (!/\s/.test(value)) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)) { try { return new URL(`http://${value}`).href; } catch { /* search */ } }
    if (/^[a-z\d](?:[a-z\d-]*\.)+[a-z\d-]+(?::\d+)?(?:[/?#]|$)/i.test(value)) { try { return new URL(`https://${value}`).href; } catch { /* search */ } }
  }
  return engines[engine].search + encodeURIComponent(value);
}

export function createTab(url = HOME): Tab {
  return { id: `tab-${crypto.randomUUID()}`, url, title: pageTitle(url), loading: false, canGoBack: false, canGoForward: false, zoom: 1 };
}
export function applyTabUpdate(tabs: Tab[], payload: TabUpdate): Tab[] {
  if(payload.url && !isWeb(payload.url)) return tabs;
  return tabs.map(tab=>tab.id===payload.id&&!isInternal(tab.url)?{...tab,...payload}:tab);
}
export function closeTab(tabs: Tab[], id: string, activeId: string): { tabs: Tab[]; activeId: string } {
  const index = tabs.findIndex(tab => tab.id === id);
  const remaining = tabs.filter(tab => tab.id !== id);
  if (!remaining.length) { const tab = createTab(); return { tabs: [tab], activeId: tab.id }; }
  return { tabs: remaining, activeId: id === activeId ? remaining[Math.min(Math.max(index, 0), remaining.length - 1)].id : activeId };
}
export function recordVisit(history: Visit[], page: Bookmark, now = Date.now()): Visit[] {
  if (!isWeb(page.url)) return history;
  const rest = history[0]?.url === page.url ? history.slice(1) : history;
  return [{ ...page, visitedAt: now }, ...rest].slice(0, 2000);
}
export function defaults(): BrowserData {
  return {
    bookmarks: [], history: [], downloads: [], session: [],
    settings: { engine: 'duckduckgo', restoreSession: true, showBookmarksBar: true },
    shortcuts: [
      { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
      { title: 'YouTube', url: 'https://www.youtube.com/' },
      { title: 'GitHub', url: 'https://github.com/' },
      { title: 'Reddit', url: 'https://www.reddit.com/' },
      { title: 'Hacker News', url: 'https://news.ycombinator.com/' },
    ],
  };
}
function bookmarks(value: unknown, limit = 500): Bookmark[] {
  return Array.isArray(value) ? value.filter((v): v is Bookmark => !!v && typeof v === 'object' && typeof v.url === 'string' && isWeb(v.url) && typeof v.title === 'string').slice(0, limit).map(v => ({url:v.url, title:v.title.slice(0,256)})) : [];
}
export function loadData(raw: string | null): BrowserData {
  const base = defaults();
  try {
    if (!raw) return base;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base;
    const d = parsed as Record<string, unknown>;
    const s = d.settings && typeof d.settings === 'object' ? d.settings as Record<string, unknown> : {};
    return {
      bookmarks: bookmarks(d.bookmarks),
      shortcuts: d.shortcuts === undefined ? base.shortcuts : bookmarks(d.shortcuts, 8),
      history: Array.isArray(d.history) ? d.history.filter((v): v is Visit => !!v && typeof v.title === 'string' && typeof v.url === 'string' && isWeb(v.url) && typeof v.visitedAt === 'number' && Number.isFinite(v.visitedAt)).slice(0, 2000) : [],
      downloads: Array.isArray(d.downloads) ? d.downloads.filter(v => !!v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.path === 'string' && typeof v.url === 'string' && ['downloading','completed','failed'].includes(v.status)).slice(0,200).map(v => ({...v, status:v.status === 'downloading' ? 'failed' : v.status})) : [],
      settings: { engine: typeof s.engine === 'string' && s.engine in engines ? s.engine as Engine : base.settings.engine, restoreSession: typeof s.restoreSession === 'boolean' ? s.restoreSession : true, showBookmarksBar: typeof s.showBookmarksBar === 'boolean' ? s.showBookmarksBar : true },
      session: Array.isArray(d.session) ? d.session.filter((v):v is Bookmark => !!v && typeof v.url === 'string' && (isWeb(v.url) || isInternal(v.url)) && typeof v.title === 'string').slice(0,30) : [],
    };
  } catch { return base; }
}
