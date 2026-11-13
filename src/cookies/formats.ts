import {cookieId} from './types';
import type {CookieRecord,SameSite} from './types';

function siteUrl(raw:string):URL {
  try{const url=new URL(raw);if(url.protocol==='https:'||url.protocol==='http:')return url;}catch{/* friendly error */}
  throw new Error('Open a website before importing or editing cookies.');
}
function flag(record:Record<string,unknown>,key:string,fallback:boolean):boolean {
  const value=record[key];if(value===undefined)return fallback;
  if(typeof value!=='boolean')throw new Error(`${key} must be true or false.`);
  return value;
}
export function validateCookie(input:unknown,url:string):CookieRecord {
  const site=siteUrl(url);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Each cookie must be an object.');
  const c=input as Record<string,unknown>;
  if(typeof c.name!=='string'||!c.name||/[^\x21-\x7e]|[()<>@,;:\\"/\[\]?={}]/.test(c.name))throw new Error('Cookie names must use ASCII without spaces, control characters, or separators.');
  if(typeof c.value!=='string'||/[^\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]/.test(c.value))throw new Error('Cookie values must use cookie-safe ASCII. Encode spaces and other characters first.');
  if(c.domain!==undefined&&typeof c.domain!=='string')throw new Error('Cookie domain must be a hostname.');
  const rawDomain=(c.domain as string|undefined)||site.hostname;
  const domain=rawDomain.replace(/^\./,'').toLowerCase();
  if(!domain||/[\s/\\:@?#]/.test(domain.replace(/^\[::1\]$/,''))||domain.startsWith('.')||domain.endsWith('.'))throw new Error('Enter a valid cookie domain without a port or URL.');
  const hostOnly=flag(c,'hostOnly',!rawDomain.startsWith('.'));
  if(hostOnly?site.hostname!==domain:site.hostname!==domain&&!site.hostname.endsWith(`.${domain}`))throw new Error('Cookie domain must match the current website.');
  if(!hostOnly&&!domain.includes('.'))throw new Error('Single-label hosts require a host-only cookie.');
  const path=c.path===undefined?'/':c.path;
  if(typeof path!=='string'||!path.startsWith('/')||/[\x00-\x1f\x7f;]/.test(path)||path.length>1024)throw new Error('Cookie path must start with / and contain no control characters.');
  if(new TextEncoder().encode(c.name+c.value+domain+path).length>4096)throw new Error('A cookie must fit within 4 KB, including name, value, domain, and path.');
  const secure=flag(c,'secure',site.protocol==='https:');const httpOnly=flag(c,'httpOnly',false);
  let sameSite:SameSite='unspecified';
  if(c.sameSite!==undefined&&c.sameSite!==null){
    if(typeof c.sameSite!=='string')throw new Error('Choose a valid SameSite value.');
    const normalized=c.sameSite.toLowerCase().replace(/[- ]/g,'_');
    if(normalized==='none'||normalized==='no_restriction')sameSite='no_restriction';
    else if(['unspecified','lax','strict'].includes(normalized))sameSite=normalized as SameSite;
    else throw new Error('Choose a valid SameSite value.');
  }
  if(sameSite==='no_restriction'&&!secure)throw new Error('SameSite=None requires Secure.');
  if(c.name.startsWith('__Secure-')&&!secure)throw new Error('__Secure- cookies require Secure.');
  if(c.name.startsWith('__Host-')&&(!secure||!hostOnly||path!=='/'))throw new Error('__Host- cookies require Secure, host-only, and path /.');
  const expiry=c.expirationDate??c.expires??null;
  if(expiry!==null&&(typeof expiry!=='number'||!Number.isFinite(expiry)||expiry>253402300799||expiry< -1))throw new Error('Expiry must be a Unix timestamp in seconds.');
  const session=flag(c,'session',expiry===null||expiry===0||expiry===-1);
  if(!session&&(expiry===null||expiry===0||expiry===-1))throw new Error('Choose an expiry or mark the cookie as a session cookie.');
  return {name:c.name,value:c.value,domain:hostOnly?domain:`.${domain}`,path,hostOnly,secure,httpOnly,sameSite,session,expirationDate:session?null:expiry as number};
}

function parseNetscape(text:string):unknown[] {
  const cookies:unknown[]=[];
  for(const [index,line] of text.split(/\r?\n/).entries()){
    if(!line.trim()||line.startsWith('#')&&!line.startsWith('#HttpOnly_'))continue;
    const columns=line.split('\t');
    if(columns.length!==7)throw new Error(`Netscape line ${index+1} must contain seven tab-separated fields.`);
    const [rawDomain,includeSubdomains,path,secure,expiry,name,value]=columns;
    if(!/^(TRUE|FALSE)$/i.test(includeSubdomains)||!/^(TRUE|FALSE)$/i.test(secure)||!/^\d+$/.test(expiry))throw new Error(`Netscape line ${index+1} has an invalid flag or expiry.`);
    cookies.push({domain:rawDomain.replace(/^#HttpOnly_/,''),hostOnly:includeSubdomains.toUpperCase()==='FALSE',path,secure:secure.toUpperCase()==='TRUE',httpOnly:rawDomain.startsWith('#HttpOnly_'),expirationDate:Number(expiry)||null,session:Number(expiry)===0,name,value});
  }
  return cookies;
}
export function parseCookieImport(text:string,url:string):CookieRecord[] {
  siteUrl(url);
  if(new TextEncoder().encode(text).length>1024*1024)throw new Error('Import must be 1 MB or smaller.');
  const trimmed=text.trim();if(!trimmed)throw new Error('Paste cookies or choose a cookie file.');
  let raw:unknown[];
  if(trimmed.startsWith('[')||trimmed.startsWith('{')){
    let parsed:unknown;try{parsed=JSON.parse(trimmed);}catch{throw new Error('Invalid JSON. Check brackets, quotes, and commas.');}
    raw=Array.isArray(parsed)?parsed:parsed&&typeof parsed==='object'&&'cookies' in parsed&&Array.isArray(parsed.cookies)?parsed.cookies:[];
    if(!Array.isArray(parsed)&&!raw.length)throw new Error('JSON must be an array of cookies or an object containing a cookies array.');
  }else if(trimmed.startsWith('#')||text.includes('\t'))raw=parseNetscape(text.replace(/^\uFEFF/,''));
  else raw=trimmed.replace(/^Cookie:\s*/i,'').split(';').filter(v=>v.trim()).map(part=>{
    const split=part.indexOf('=');if(split<1)throw new Error('Cookie headers must contain name=value pairs.');
    return {name:part.slice(0,split).trim(),value:part.slice(split+1).trim()};
  });
  if(!raw.length)throw new Error('No cookies were found.');
  if(raw.length>500)throw new Error('Import at most 500 cookies at a time.');
  const cookies=raw.map((record,index)=>{try{return validateCookie(record,url);}catch(error){throw new Error(`Cookie ${index+1}: ${(error as Error).message}`);}});
  const seen=new Set<string>();for(const cookie of cookies){const key=cookieId(cookie);if(seen.has(key))throw new Error('Duplicate cookie name, domain, and path in this import.');seen.add(key);}
  return cookies;
}
export function exportJson(cookies:CookieRecord[]):string{return JSON.stringify(cookies,null,2);}
export function exportNetscape(cookies:CookieRecord[]):string{
  return '# Netscape HTTP Cookie File\n# Exported by Mxplorer. Keep this file private.\n'+cookies.map(c=>[`${c.httpOnly?'#HttpOnly_':''}${c.domain}`,c.hostOnly?'FALSE':'TRUE',c.path,c.secure?'TRUE':'FALSE',c.session?'0':Math.floor(c.expirationDate||0),c.name,c.value].join('\t')).join('\n')+'\n';
}
