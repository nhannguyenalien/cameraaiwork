import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PRODUCT_KNOWLEDGE } from '../functions/_lib/productKnowledge.js';
import { chatSchoolsSupport, chatSchoolsOperator } from '../functions/_lib/schoolsAi.js';

test('published guide matches knowledge sent to SchoolsAI', async () => {
 assert.equal(await readFile(new URL('../public/docs/agent-guide.txt',import.meta.url),'utf8'),PRODUCT_KNOWLEDGE);
});
test('support includes setup instructions within remote question limit',async(t)=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  assert.ok(body.question.includes(PRODUCT_KNOWLEDGE));
  assert.match(body.question,/Respond to the user in English/);
  assert.ok(body.question.length<=10000,`question length ${body.question.length}`);
  return Response.json({answer:'OK'});
 };
 await chatSchoolsSupport({SCHOOLSAI_API_KEY:'test'},{session:'test',question:'x'.repeat(2000),language:'en'});
});
test('operator retains guide and protocol when history is full, within API limits',async(t)=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 const requestId='11111111-1111-4111-8111-111111111111';
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  assert.equal(body.messages.length,20);
  assert.equal(body.messages[1].content,PRODUCT_KNOWLEDGE);
  assert.match(body.messages[0].content,/Danh mục công cụ/);
  assert.equal(body.messages.at(-1).content,'question 39');
  for(const message of body.messages)assert.ok(message.content.length<=8000,`message length ${message.content.length}`);
  return Response.json({request_id:requestId,type:'answer',answer:'OK'});
 };
 await chatSchoolsOperator({SCHOOLSAI_API_KEY:'test'},{requestId,session:'test',messages:Array.from({length:40},(_,i)=>({role:i%2?'user':'assistant',content:`question ${i}`})),execute:()=>{throw new Error('unexpected');}});
});
