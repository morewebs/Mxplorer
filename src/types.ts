export type Engine = 'duckduckgo' | 'google' | 'bing';
export type InternalPage = 'newtab' | 'history' | 'bookmarks' | 'downloads' | 'settings';
export interface Tab { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; zoom: number }
export interface Bookmark { url: string; title: string }
export interface Visit extends Bookmark { visitedAt: number }
export interface Download { id: string; url: string; name: string; path: string; status: 'downloading' | 'completed' | 'failed' }
export interface Settings { engine: Engine; restoreSession: boolean; showBookmarksBar: boolean }
export interface BrowserData { bookmarks: Bookmark[]; history: Visit[]; downloads: Download[]; shortcuts: Bookmark[]; settings: Settings; session: Bookmark[] }
export interface Bounds { x: number; y: number; width: number; height: number }
export interface TabUpdate { id: string; url?: string; title?: string; loading?: boolean; canGoBack?: boolean; canGoForward?: boolean; error?: string|null }
