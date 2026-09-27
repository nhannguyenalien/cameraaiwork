import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { statements } from '../migrations/002-offline-events.mjs';
import { persistOfflineEvent, readOfflineForm } from '../functions/_lib/offlineEvents.js';

test('durable ingestion retries media failures, deduplicates concurrent requests and preserves original timestamp', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE events(id serial PRIMARY KEY, account_id text, site_id text, camera text, timestamp timestamptz,
      type text, video_status text, video_error text, image_key text, video_key text, storage_backend text)`);
    for (let i = 0; i < 2; i++) for (const sql of statements) await pg.exec(sql);
    const db = { execute: async ({ sql, args }) => { let n = 0; return pg.query(sql.replace(/\?/g, () => '$' + ++n), args); } };
    const event = { id: randomUUID(), camera: 'cam', occurredAt: '2026-09-26T02:03:04.123Z' };
    const uploads = [];
    const input = { db, site: { id: 'site-a', account_id: 'account-a' }, event, image: new Uint8Array([255,216]), video: new Uint8Array([1]), shouldRecord: true, chain: ['s3','r2'], put: async (backend, key) => { uploads.push([backend,key]); if (backend === 's3') throw Error('down'); } };
    await assert.rejects(persistOfflineEvent({ ...input, put: async () => { throw Error('offline'); } }), /offline/);
    let rows = (await pg.query('SELECT * FROM events')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relay_sync_complete, false);
    const results = await Promise.all([persistOfflineEvent(input), persistOfflineEvent(input)]);
    assert.equal(results.filter(result => result.newlySynced).length, 1);
    assert.equal(results[0].ack.sourceEventId, event.id);
    rows = (await pg.query('SELECT * FROM events')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].timestamp.toISOString(), event.occurredAt);
    assert.equal(rows[0].storage_backend, 'r2');
    assert.equal(rows[0].video_status, 'ready');
    assert.ok(rows[0].image_key && rows[0].video_key);
    const count = uploads.length;
    assert.equal((await persistOfflineEvent(input)).newlySynced, false);
    assert.equal(uploads.length, count);
    await assert.rejects(persistOfflineEvent({ ...input, event: { ...event, camera: 'other' } }), /identity/);
    await persistOfflineEvent({ ...input, site: { id: 'site-b', account_id: 'account-b' }, shouldRecord: false });
    rows = (await pg.query("SELECT * FROM events WHERE site_id='site-b'")).rows;
    assert.equal(rows[0].video_key, null);
    assert.equal(rows[0].video_status, 'disabled');
    await persistOfflineEvent({ ...input, event: { ...event, id: randomUUID(), captureError: 'camera down' }, video: undefined });
    rows = (await pg.query("SELECT * FROM events WHERE video_status='error'")).rows;
    assert.equal(rows[0].video_error, 'camera down');
  } finally { await pg.close(); }
});

test('multipart validation accepts original media and rejects invalid identity, format and oversized bodies', async () => {
  const event = { id: randomUUID(), camera: 'cam', occurredAt: new Date().toISOString(), trusted: true };
  const request = (metadata, image = new Uint8Array([255,216,255])) => {
    const form = new FormData();
    form.append('metadata', JSON.stringify(metadata));
    form.append('image', new Blob([image]), 'image.jpg');
    return new Request('https://test/api/motion', { method: 'POST', body: form });
  };
  const result = await readOfflineForm(request(event));
  assert.equal(result.event.id, event.id);
  assert.equal(result.image[0], 255);
  await assert.rejects(readOfflineForm(request({ ...event, id: '../x' })), /Invalid event/);
  await assert.rejects(readOfflineForm(request({ ...event, trusted: false })), /Invalid event/);
  await assert.rejects(readOfflineForm(request(event, new Uint8Array([1,2]))), /format/);
  await assert.rejects(readOfflineForm(new Request('https://test', { method: 'POST', headers: { 'content-length': String(25 * 1024 ** 2) }, body: 'x' })), error => error.status === 413);
});

test('policy endpoint authenticates per site and applies account clip limits; unauthorized uploads are rejected before parsing', async () => {
  const { neonConfig } = await import('@neondatabase/serverless');
  const { onRequestGet, onRequestPost } = await import('../functions/api/motion.js');
  const pg = new PGlite();
  const original = neonConfig.fetchFunction;
  try {
    await pg.exec(`CREATE TABLE sites(id text, account_id text, relay_secret text);
      CREATE TABLE accounts(id text, plan text, subscription_status text, clip_duration_seconds integer);
      CREATE TABLE cameras(site_id text, account_id text, stream text, record_on_person integer, clip_duration_seconds integer);
      INSERT INTO sites VALUES ('a','account-a','secret-a'),('b','account-b','secret-b');
      INSERT INTO accounts VALUES ('account-a','free','inactive',60),('account-b','pro','active',30);
      INSERT INTO cameras VALUES ('a','account-a','front',1,60),('a','account-a','private',0,10),('b','account-b','other',1,30);`);
    neonConfig.fetchFunction = async (_, init) => {
      const body = JSON.parse(init.body);
      const r = await pg.query(body.query, body.params);
      return Response.json({ fields: r.fields, rowCount: r.affectedRows ?? r.rows.length,
        rows: r.rows.map(row => r.fields.map(field => row[field.name] == null ? null : String(row[field.name]))) });
    };
    const env = { DATABASE_URL: 'postgresql://user:pass@example.neon.tech/db', DB_METRICS: '0' };
    const context = (site, secret, method = 'GET') => ({ env, request: new Request('https://test/api/motion?siteId=' + site, {
      method, headers: { 'x-relay-secret': secret, ...(method === 'POST' ? { 'content-type': 'multipart/form-data; boundary=test' } : {}) },
      ...(method === 'POST' ? { body: 'malformed body' } : {}),
    }) });
    let response = await onRequestGet(context('a','secret-a'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { cameras: { front: { recordOnPerson: true, clipDurationSeconds: 10 }, private: { recordOnPerson: false, clipDurationSeconds: 10 } } });
    assert.equal((await onRequestGet(context('b','secret-a'))).status, 401);
    const unauthorized = context('a','wrong','POST');
    assert.equal((await onRequestPost(unauthorized)).status, 401);
    assert.equal(unauthorized.request.bodyUsed, false);
  } finally { neonConfig.fetchFunction = original; await pg.close(); }
});
