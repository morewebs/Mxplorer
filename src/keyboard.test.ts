import { describe,it,expect } from 'vitest';
import {browserShortcut} from './keyboard';
const key=(key:string,ctrlKey=false,shiftKey=false,altKey=false)=>browserShortcut({key,ctrlKey,shiftKey,altKey,metaKey:false});
describe('browser keyboard conventions',()=>{
  it('uses the familiar bookmark and tab search shortcuts',()=>{
    expect(key('b',true,true)).toBe('toggle-bookmarks-bar');
    expect(key('o',true,true)).toBe('bookmarks');
    expect(key('a',true,true)).toBe('search-tabs');
  });
  it('recognizes function keys even with modifiers',()=>{
    expect(key('F5')).toBe('reload');expect(key('F5',true)).toBe('hard-reload');expect(key('F5',false,true)).toBe('hard-reload');expect(key('F11')).toBe('fullscreen');
  });
  it('does not intercept ordinary editing or alt shortcuts',()=>{
    expect(key('a',true)).toBeNull();expect(key('c',true)).toBeNull();expect(key('x',true)).toBeNull();expect(key('t')).toBeNull();expect(key('ArrowLeft',false,false,true)).toBe('back');
  });
});
