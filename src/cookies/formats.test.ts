import {describe,it,expect} from 'vitest';
import {parseCookieImport,validateCookie,exportJson,exportNetscape} from './formats';
const url='https://app.example.com/account';
const cookie={name:'session_test',value:'synthetic-value',domain:'.example.com',path:'/',secure:true,httpOnly:true,hostOnly:false,sameSite:'lax' as const,session:false,expirationDate:2000000000};
describe('cookie import and export',()=>{
  it('roundtrips Cookie-Editor JSON without dropping security fields',()=>{
    expect(parseCookieImport(exportJson([cookie]),url)).toEqual([cookie]);
  });
  it('accepts wrapped arrays and Playwright expiry/SameSite aliases',()=>{
    const [result]=parseCookieImport(JSON.stringify({cookies:[{name:'x',value:'1',domain:'app.example.com',path:'/',expires:-1,sameSite:'None',secure:true}]}),url);
    expect(result).toMatchObject({session:true,expirationDate:null,sameSite:'no_restriction',hostOnly:true});
  });
  it('roundtrips Netscape HttpOnly cookies and preserves empty/equals values',()=>{
    const values=[cookie,{...cookie,name:'empty',value:''},{...cookie,name:'equals',value:'a=b=c'}];
    expect(parseCookieImport(exportNetscape(values),url)).toEqual(values.map(c=>({...c,sameSite:'unspecified'})));
    expect(exportNetscape([cookie])).toContain('#HttpOnly_.example.com');
    expect(parseCookieImport(exportNetscape([{...cookie,value:''}]),url)[0].value).toBe('');
  });
  it('reads a Cookie header with an embedded equals sign',()=>{
    const result=parseCookieImport('Cookie: a=one=two; b=; c=hello',url);
    expect(result.map(c=>[c.name,c.value])).toEqual([['a','one=two'],['b',''],['c','hello']]);
    expect(result.every(c=>c.domain==='app.example.com'&&c.hostOnly&&c.session)).toBe(true);
  });
  it('rejects the entire import on invalid records, duplicates or unrelated domains',()=>{
    for(const value of [JSON.stringify([cookie,{...cookie,name:'bad\nname'}]),JSON.stringify([cookie,cookie]),JSON.stringify([{...cookie,domain:'.unrelated.com'}]),JSON.stringify([null]),'not a cookie']){
      expect(()=>parseCookieImport(value,url)).toThrow();
    }
  });
  it('rejects malformed security, path, expiry and prefix combinations',()=>{
    for(const change of [{secure:'false'},{path:'relative'},{expirationDate:'tomorrow'},{sameSite:'None',secure:false},{name:'__Host-id',hostOnly:false},{name:'__Secure-id',secure:false},{value:'a\rb'},{value:'two words'},{name:'námé'}]){
      expect(()=>validateCookie({...cookie,...change},url)).toThrow();
    }
  });
  it('scopes host-only and domain cookies correctly, including localhost',()=>{
    expect(()=>validateCookie({...cookie,hostOnly:true,domain:'example.com'},url)).toThrow();
    expect(validateCookie({name:'local',value:'test'},'http://localhost:17329')).toMatchObject({domain:'localhost',hostOnly:true,secure:false,session:true});
    expect(()=>parseCookieImport('a=1','mxplorer://newtab')).toThrow('Open a website');
  });
  it('limits input size and cookie count before native work',()=>{
    expect(()=>parseCookieImport('a'.repeat(1024*1024+1),url)).toThrow('1 MB');
    expect(()=>parseCookieImport(JSON.stringify(Array.from({length:501},(_,i)=>({...cookie,name:`c${i}`}))),url)).toThrow('500');
  });
});
