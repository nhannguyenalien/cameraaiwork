import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteClient } from './helpers/pgliteClient.mjs';
import { statements } from '../migrations/003-gate-butler.mjs';
import { onRequestPost as turn } from '../functions/api/voice/turn.js';
import { onRequestPost as greeting } from '../functions/api/voice/greeting.js';
import { onRequestPost as finish } from '../functions/api/voice/finish.js';
import { onRequestPatch as saveSettings } from '../functions/api/cameras/[site]/[camera]/settings.js';
import { offlinePolicy } from '../functions/_lib/offlineEvents.js';

const KEY = 'sk_' + 'a'.repeat(40);

async function setup() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE sites(id text PRIMARY KEY, account_id text, relay_secret text);
    CREATE TABLE accounts(id text PRIMARY KEY, plan text DEFAULT 'free', subscription_status text, clip_duration_seconds integer, video_retention_days integer DEFAULT 7);
    CREATE TABLE cameras(id text PRIMARY KEY, site_id text, account_id text, stream text, name text, record_on_person integer DEFAULT 1, clip_duration_seconds integer);
    CREATE TABLE agent_messages(id serial PRIMARY KEY, account_id text, role text, content text, source text, created_at timestamptz DEFAULT now());
    CREATE TABLE account_integrations(account_id text, provider text, encrypted_config text, updated_at timestamptz DEFAULT now(), PRIMARY KEY(account_id, provider));
    INSERT INTO accounts VALUES ('acc','free','inactive',10);
    INSERT INTO sites VALUES ('site1','acc','secret1'),('site2','acc2','secret2');
    INSERT INTO cameras(id,site_id,account_id,stream,name) VALUES ('cam1','site1','acc','gate','Cổng');`);
  for (const sql of statements) await pg.exec(sql);
  const env = {
    DB_CLIENT: pgliteClient(pg), DB_METRICS: '0',
    CUSTOMER_SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  return { pg, env };
}

const relay = (path, env, { secret = 'secret1', body, type = 'audio/webm', query = '' } = {}) => ({
  env, waitUntil: p => p, data: {},
  request: new Request(`https://t/api/voice/${path}?siteId=site1&camera=gate&visit=visit-0001${query}`, {
    method: 'POST', headers: { 'x-relay-secret': secret, ...(type ? { 'content-type': type } : {}) }, body,
  }),
});

test('gate butler: enabling needs a valid key, relay endpoints enforce auth, turns are limited and summarised', async () => {
  const { pg, env } = await setup();
  const realFetch = globalThis.fetch;
  const calls = [];
  let needsHuman = false;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith('https://apic.schoolsai.work')) return realFetch(url, init);
    calls.push(u.replace('https://apic.schoolsai.work/api/v1/', ''));
    if (u.endsWith('/config')) return Response.json({ success: true, config: {} });
    if (u.endsWith('/greeting')) return Response.json({ success: true, text: 'Xin chào', audioBase64: 'QUJD' });
    return Response.json({ success: true, transcript: 'Tôi giao hàng', reply: 'Để hàng ở kệ nhé', audioBase64: 'REVG', needsHuman });
  };
  try {
    const patch = body => saveSettings({ env, data: { accountId: 'acc' }, params: { site: 'site1', camera: 'cam1' },
      request: new Request('https://t', { method: 'PATCH', body: JSON.stringify(body) }) });

    assert.equal((await patch({ securityLevel: 'high' })).status, 400, 'high security without a key is refused');
    assert.equal((await patch({ voiceApiKey: 'nope' })).status, 400);
    const saved = await patch({ voiceApiKey: KEY, securityLevel: 'high' });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.securityLevel, 'high');
    assert.equal(savedBody.voiceConfigured, true);
    const stored = (await pg.query('SELECT voice_key_enc FROM cameras')).rows[0].voice_key_enc;
    assert.ok(stored && !stored.includes(KEY), 'key is stored encrypted');

    const policy = await (await offlinePolicy({ env, request: new Request('https://t/api/motion?siteId=site1', { headers: { 'x-relay-secret': 'secret1' } }) })).json();
    assert.equal(policy.cameras.gate.gateButler, true);

    assert.equal((await turn(relay('turn', env, { secret: 'wrong', body: new Uint8Array([1, 2]) }))).status, 401);
    assert.equal((await turn(relay('turn', env, { body: new Uint8Array([1]), type: 'text/plain' }))).status, 415);

    const greet = await (await greeting(relay('greeting', env, { type: null }))).json();
    assert.equal(greet.audioBase64, 'QUJD');
    assert.equal(greet.cached, false);
    assert.equal((await (await greeting(relay('greeting', env, { type: null, query: '' }))).json()).cached, true);
    assert.equal(calls.filter(c => c === 'ai-voice/greeting').length, 1, 'greeting generated once then cached');

    let last;
    for (let i = 1; i <= 4; i++) {
      last = await (await turn(relay('turn', env, { body: new Uint8Array([1, 2, 3]) }))).json();
      assert.equal(last.done, i === 4, `turn ${i}`);
    }
    assert.equal(last.reply, 'Để hàng ở kệ nhé');
    const over = await (await turn(relay('turn', env, { body: new Uint8Array([1]) }))).json();
    assert.equal(over.done, true);
    assert.equal(calls.filter(c => c === 'ai-voice/turn').length, 4, 'no upstream call past the turn limit');

    const closed = (await pg.query("SELECT status, summary, turns FROM gate_visits")).rows[0];
    assert.equal(closed.status, 'closed');
    assert.match(closed.summary, /Tôi giao hàng/);
    const chat = (await pg.query('SELECT content FROM agent_messages')).rows;
    assert.equal(chat.length, 1, 'owner gets exactly one summary');
    assert.match(chat[0].content, /Quản gia cổng/);
    assert.equal((await finish(relay('finish', env, { type: null }))).status, 200);
    assert.equal((await pg.query('SELECT * FROM agent_messages')).rows.length, 1, 'finish is idempotent');

    needsHuman = true;
    const human = await (await turn({ ...relay('turn', env, { body: new Uint8Array([1]) }), request: new Request('https://t/api/voice/turn?siteId=site1&camera=gate&visit=visit-0002', { method: 'POST', headers: { 'x-relay-secret': 'secret1', 'content-type': 'audio/webm' }, body: new Uint8Array([1]) }) })).json();
    assert.equal(human.done, true);
    assert.equal(human.needsHuman, true);

    await patch({ securityLevel: 'normal' });
    assert.equal((await greeting(relay('greeting', env, { type: null }))).status, 403, 'normal camera has no butler');
  } finally { globalThis.fetch = realFetch; await pg.close(); }
});
