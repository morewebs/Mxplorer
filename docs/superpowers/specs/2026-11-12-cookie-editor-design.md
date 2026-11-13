# Sidebar cookie editor

The user requested a Cookie-Editor-like feature built into the sidebar, with imported cookies persistently restored after clearing/reset. They explicitly chose both policies as user-selectable: restore missing cookies while preserving website changes, or restore exact saved values after replacement/deletion.

## Behavior

A Cookies toolbar/menu entry opens a wider sidebar consistent with the monochrome UI. The current website's cookies can be searched, inspected, added, edited, deleted, imported and exported. Fields include name/value/domain/path, expiry or session, Secure, HttpOnly, SameSite and host-only behavior. Imports accept Cookie-Editor JSON, Netscape cookies.txt and Cookie header text. Exports support JSON and Netscape. Values stay masked until revealed or edited; exports require an explicit action. Preview mode clearly cannot access native cookies.

An import or edit chooses No auto-restore, Restore missing, or Keep exact values. Saved records survive restart in a Windows DPAPI-encrypted file, never UI localStorage or Git. Native background reconciliation runs even with the sidebar closed and on startup/before first website navigation. Missing mode preserves refreshed values; exact mode reapplies differing saved values and attributes. Expired saved templates are renewed when restored, using their saved remaining lifetime or 30 days for expired/session input, while session semantics remain visible. Surface this renewal behavior in the UI. Restoring cookie bytes cannot revive a server-revoked session.

Saved entries have enable/pause, mode, restore-now and forget controls. Deleting an individual cookie in the editor also forgets its saved copy so the delete sticks. Clearing live cookies explicitly retains saved copies and warns they will return; clearing global browser data likewise restores enabled saved cookies afterward. Saved copies must be forgotten to remove them permanently. No silent reloading of websites after edits; provide Reload page.

Use WebView2's native cookie store, including HttpOnly cookies, sharing GuestProfile across tabs and a hidden maintenance view. Import validation is atomic and restricts cookies to the selected site's domain/parent-domain rules; block unrelated and public-suffix domains. Browser chrome-only command guards remain enforced. No cookie values in logs, documentation, fixtures, notifications or external services. Synthetic test fixtures only.

## Native contract

CookieRecord: {name,value,domain,path,secure,httpOnly,hostOnly,sameSite:'unspecified'|'no_restriction'|'lax'|'strict',session,expirationDate:number|null}.
CookieKey: {name,domain,path,hostOnly:boolean}. SavedCookie: {cookie:CookieRecord,mode:'missing'|'exact',enabled:boolean,savedAt:number,renewalSeconds:number}.
CookieSnapshot: {cookies:CookieRecord[],saved:SavedCookie[],lastRestoredAt:number|null,restoredCount:number,error:string|null}.

Commands, all trusted-caller guarded:
- get_cookies {url:string|null}: snapshot. Null yields all saved entries but no live cookies.
- save_cookies {url:string,cookies:CookieRecord[],mode:'none'|'missing'|'exact',original?:CookieKey|null}: validate batch, apply, optionally persist; editing identity removes original live/saved key.
- delete_cookies {url:string,keys:CookieKey[],forgetSaved:boolean}: remove selected live cookies and optionally saved keys.
- set_saved_cookie {key:CookieKey,enabled?:boolean|null,mode?:'missing'|'exact'|null,remove?:boolean,url?:string|null}: manage saved record.
- restore_cookies {url?:string|null}: immediate reconciliation, snapshot.

No cookie values are added to BrowserData/localStorage. Sidebar polls while visible; native reconciliation is independent.
