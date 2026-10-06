import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { neonConfig } from '@neondatabase/serverless';
import { statements } from '../migrations/001-network-transfer.mjs';
import { findOrCreatePerson } from '../functions/_lib/faceMatch.js';
import { onRequestGet as people } from '../functions/api/people/index.js';
import { onRequestGet as events } from '../functions/api/events/index.js';
import { measureDb } from '../functions/_lib/dbMetrics.js';

test('PostgreSQL vector matching, isolation, pagination and event deltas', async () => {
 const db = new PGlite({ extensions: { vector } });
 const oldFetch = neonConfig.fetchFunction;
 try {
  for (const table of ['people','gpu_people']) await db.exec(`CREATE TABLE ${table}(id text PRIMARY KEY,account_id text,embedding text,label text,first_seen_at timestamptz DEFAULT now(),last_seen_at timestamptz DEFAULT now(),seen_count integer DEFAULT 1)`);
  await db.exec(`CREATE TABLE events(id serial PRIMARY KEY,account_id text,person_id text,timestamp timestamptz DEFAULT now(),image_key text,video_key text,acknowledged boolean DEFAULT false);
    CREATE TABLE event_people(event_id integer,person_id text,face_box text);
    CREATE TABLE event_gpu_people(event_id integer,person_id text,face_box text);
    INSERT INTO people(id,account_id,embedding) VALUES ('broken','a','bad'),('zero','a','[0,0]'),('dimension','a','[1,0,0]');`);
  for (let run=0;run<2;run++) for (const sql of statements) await db.exec(sql);
  neonConfig.fetchFunction = async (_, init) => {
   const body = JSON.parse(init.body);
   const execute = async q => {
    const r = await db.query(q.query,q.params);
    return { fields:r.fields, rowCount:r.affectedRows ?? r.rows.length, rows:r.rows.map(row=>r.fields.map(f=>{
     const v=row[f.name]; return v==null?null:typeof v==='object'?JSON.stringify(v):String(v);
    })) };
   };
   return Response.json(body.queries?{results:await Promise.all(body.queries.map(execute))}:await execute(body));
  };
  const env={DATABASE_URL:'postgresql://user:pass@example.neon.tech/db',DB_METRICS:'0'};
  const id=await findOrCreatePerson(env,'a',[1,0]);
  assert.ok(id);
  assert.equal(await findOrCreatePerson(env,'a',[0.99,0.01]),id);
  assert.notEqual(await findOrCreatePerson(env,'b',[1,0]),id);
  assert.notEqual(await findOrCreatePerson(env,'a',[1,0],'gpu'),id);
  assert.notEqual(await findOrCreatePerson(env,'a',[-1,0]),id);
  assert.equal(await findOrCreatePerson(env,'a',[0,0]),null);
  assert.equal(await findOrCreatePerson(env,'a',[NaN,0]),null);
  await db.query('UPDATE people SET label=$1 WHERE id=$2',['Alice',id]);
  const call=async(handler,path)=>handler({request:new Request('https://test'+path),env,data:{accountId:'a'}});
  let response=await call(people,'/api/people?page=1&limit=2');
  assert.equal(response.status,200); const firstPage=await response.json(); assert.equal(firstPage.length,2);
  assert.equal(firstPage[0].embedding,undefined);
  const secondPage=await (await call(people,'/api/people?page=2&limit=2')).json();
  assert.ok(secondPage.every(row=>!firstPage.some(first=>first.id===row.id)));
  response=await call(people,'/api/people?filter=named&search=ali');
  assert.equal(response.headers.get('x-filtered-count'),'1');
  assert.equal((await response.json())[0].id,id);
  assert.equal((await call(people,'/api/people?limit=101')).status,400);
  await db.query('INSERT INTO events(account_id,person_id,image_key) VALUES ($1,$2,$3)',['a',id,'image']);
  await db.exec("INSERT INTO events(account_id) VALUES ('b')");
  const read=async known=>(await call(events,'/api/events?page=1&limit=20&delta=1&known='+encodeURIComponent(JSON.stringify(known||{})))).json();
  let delta=await read(); assert.equal(delta.total,1);assert.equal(delta.rows.length,1);
  const initialBytes=JSON.stringify(delta).length;
  let known=Object.fromEntries(delta.manifest.map(r=>[r.id,r.version]));
  delta=await read(known);assert.equal(delta.rows.length,0);assert.equal(delta.manifest.length,1);assert.ok(JSON.stringify(delta).length<initialBytes);
  await db.exec("UPDATE events SET video_key='video' WHERE account_id='a'");
  delta=await read(known);assert.equal(delta.rows.length,1);assert.equal(delta.rows[0].video_key,'video');
  known=Object.fromEntries(delta.manifest.map(r=>[r.id,r.version]));
  await db.query('UPDATE people SET label=$1 WHERE id=$2',['Renamed',id]);
  delta=await read(known);assert.equal(delta.rows[0].person_label,'Renamed');
  await db.exec("DELETE FROM events WHERE account_id='a'");
  delta=await read(known);assert.equal(delta.manifest.length,0);assert.equal(delta.total,0);
 } finally { neonConfig.fetchFunction=oldFetch;await db.close(); }
});
test('metrics do not expose query, parameters or returned values',async()=>{
 const old=console.log;const logs=[];console.log=x=>logs.push(JSON.parse(x));
 try {
  await measureDb({},'face.local','SELECT secret',async()=>[{secret:'private'}]);
  await assert.rejects(measureDb({},'face.local','SELECT secret',async()=>{throw Error('password')}));
  assert.equal(logs.length,2);assert.ok(logs[0].payload_bytes>0);assert.equal(logs[1].ok,false);
  assert.doesNotMatch(JSON.stringify(logs),/secret|private|password/);
 } finally {console.log=old;}
});
