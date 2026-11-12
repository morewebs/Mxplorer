export interface KeyInput { key:string; ctrlKey:boolean; metaKey:boolean; shiftKey:boolean; altKey:boolean }
export function browserShortcut(event:KeyInput):string|null {
  const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
  if(key==='f11')return 'fullscreen';
  if(key==='f5')return mod||event.shiftKey?'hard-reload':'reload';
  if(event.altKey&&!mod){if(key==='arrowleft')return 'back';if(key==='arrowright')return 'forward';if(key==='d')return 'focus-address';}
  if(!mod||event.altKey)return null;
  if(/^[1-9]$/.test(key))return `select-tab-${key}`;
  if(key==='tab')return event.shiftKey?'previous-tab':'next-tab';
  if(key==='t')return event.shiftKey?'restore-tab':'new-tab';
  if(key==='r')return event.shiftKey?'hard-reload':'reload';
  if(key==='b'&&event.shiftKey)return 'toggle-bookmarks-bar';
  if(key==='o'&&event.shiftKey)return 'bookmarks';
  if(key==='a'&&event.shiftKey)return 'search-tabs';
  return ({w:'close-tab',l:'focus-address',k:'focus-address',h:'history',j:'downloads',d:'bookmark-page',f:'find',p:'print','=':'zoom-in','+':'zoom-in','-':'zoom-out','0':'zoom-reset'} as Record<string,string>)[key]||null;
}
