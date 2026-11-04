import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL('../public/'+name, import.meta.url),'utf8');
function setup(lang='en') {
  const handlers={}; const store=new Map();
  const context={window:{},document:{title:'Camera',documentElement:{lang},addEventListener:(name,fn)=>handlers[name]=fn},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},location:{search:'?lang='+lang},navigator:{language:lang},URLSearchParams,Node:{COMMENT_NODE:8,TEXT_NODE:3,ELEMENT_NODE:1,DOCUMENT_NODE:9},MutationObserver:class{observe(){}}};
  vm.createContext(context); vm.runInContext(read('ui-translations.js'),context); vm.runInContext(read('ui-i18n-fallback.js'),context);
  return context;
}
test('all catalog entries have five complete translations and preserve placeholders',()=>{
 const c=setup().window.CameraTranslations;
 for(const [source,values] of Object.entries(c)) for(const lang of ['en','ja','fr','ko','es']) {
  assert.ok(values[lang],`${source}: ${lang}`);
  const tokens=s=>(s.match(/\{\w+\}|\$\d+/g)||[]).sort();
  assert.deepEqual(tokens(values[lang]),tokens(source.startsWith('@')?values.en:source),`${source}: ${lang}`);
 }
});
test('dialogs and dynamic templates translate without changing interpolated data',()=>{
 for(const lang of ['en','ja','fr','ko','es']) {
  const {window:w}=setup(lang);
  assert.notEqual(w.uiText('Tên preset mới:'),'Tên preset mới:');
  assert.equal(w.uiText('Không tải được XYZ'),w.uiText('Không tải được {0}',{0:'XYZ'}));
  assert.ok(w.uiText('Thu hồi key "{0}"? Mọi request dùng key này sẽ ngừng hoạt động ngay.',{0:'$& <My key>'}).includes('$& <My key>'));
 }
});
test('DOM translation respects updated text and restores Vietnamese',()=>{
 const c=setup();const node={nodeType:3,nodeValue:'Đang cập nhật…',parentElement:{closest:()=>null}};
 c.document.body=node;c.window.applyLegacyTranslations();assert.equal(node.nodeValue,'Updating…');
 node.nodeValue='Đã cập nhật';c.window.applyLegacyTranslations();assert.equal(node.nodeValue,'Updated');
 c.document.documentElement.lang='vi';c.window.applyLegacyTranslations();assert.equal(node.nodeValue,'Đã cập nhật');
});
test('pages share language preference and do not fix date formatting to Vietnamese',()=>{
 for(const page of ['privacy','terms','docs']) assert.match(read(page+'/i18n.js'),/localStorage.setItem\('cameraaiwork_docs_language'/);
 for(const page of ['index.html','camera.html']) {assert.doesNotMatch(read(page),/toLocale(?:Date)?String\('vi-VN'/);assert.match(read(page),/ui-translations.js/);}
});
