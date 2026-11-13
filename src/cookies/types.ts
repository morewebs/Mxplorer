export type SameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict';
export type RestoreMode = 'none' | 'missing' | 'exact';
export interface CookieKey { name:string; domain:string; path:string; hostOnly:boolean }
export interface CookieRecord extends CookieKey {
  value:string; secure:boolean; httpOnly:boolean; sameSite:SameSite;
  session:boolean; expirationDate:number|null;
}
export interface SavedCookie { cookie:CookieRecord; mode:Exclude<RestoreMode,'none'>; enabled:boolean; savedAt:number; renewalSeconds:number }
export interface CookieSnapshot { cookies:CookieRecord[]; saved:SavedCookie[]; lastRestoredAt:number|null; restoredCount:number; error:string|null }
export const emptySnapshot=():CookieSnapshot=>({cookies:[],saved:[],lastRestoredAt:null,restoredCount:0,error:null});
export function cookieKey(cookie:CookieKey):CookieKey { return {name:cookie.name,domain:cookie.domain,path:cookie.path,hostOnly:cookie.hostOnly}; }
export function cookieId(cookie:CookieKey):string { return JSON.stringify([cookie.name,cookie.domain.replace(/^\./,'').toLowerCase(),cookie.path,cookie.hostOnly]); }
export const restoreModes:Record<RestoreMode,{label:string;description:string}>={
  none:{label:'No auto-restore',description:'Import once. The website manages these cookies normally.'},
  missing:{label:'Restore missing',description:'Restore deleted or expired cookies. Keep changes made by the website.'},
  exact:{label:'Keep exact values',description:'Restore deleted cookies and replace changes with your saved values.'},
};
