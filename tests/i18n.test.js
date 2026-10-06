import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messages, translate, readLanguage } from '../i18n.js';

test('every static UI label has both translations with matching placeholders',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g))assert.ok(messages[match[1]],match[1]);
  for(const [key,[zh,en]] of Object.entries(messages)){
    assert.ok(zh.length&&en.length,key);
    assert.doesNotMatch(en,/[\u3400-\u9fff]/,key);
    assert.deepEqual(zh.match(/\{\w+\}/g)?.sort(),en.match(/\{\w+\}/g)?.sort(),key);
  }
});
test('selection status keeps coordinates and counts in either language',()=>{
  assert.equal(translate('en','regionCount',{count:3}),'Sound source: 3 regions');
  assert.equal(translate('zh','regionCount',{count:3}),'取声范围：3 个选区');
  assert.equal(translate('en','regionSize',{width:20,height:15,x:8,y:6}),'Sound source: 20 × 15 region at (8, 6)');
});
test('language preference safely defaults to Chinese when unavailable or invalid',()=>{
  assert.equal(readLanguage({getItem:()=> 'en'}),'en');
  assert.equal(readLanguage({getItem:()=> null}),'zh');
  assert.equal(readLanguage({getItem:()=> 'invalid'}),'zh');
  assert.equal(readLanguage({getItem:()=> {throw new Error('Storage blocked');}}),'zh');
});
