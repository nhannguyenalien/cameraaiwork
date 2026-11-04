import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgliteClient } from './helpers/pgliteClient.mjs';
import { saveStorageConnection, storageConnections, storagePolicy } from '../functions/_lib/storagePolicy.js';
import { updateIntegration, getIntegration, setIntegration } from '../functions/_lib/integrations.js';
import { putObject, getObject, deleteObjects } from '../functions/_lib/objectStorage.js';
import { onRequestGet } from '../functions/api/settings/storage-config.js';

const add = (saved, provider, number, plan = 'pro') => saveStorageConnection(saved, provider,
  provider === 'gdrive' ? { folderId: `folder-${number}`, refreshToken: `private-${number}` } : { endpoint: 'https://s3.example.com', region: 'auto', bucket: `bucket-${number}`, accessKeyId: `key-${number}`, secretAccessKey: `private-${number}` },
  { connectionId: null, newId: `${provider}-${number}`, name: `Storage ${number}`, plan });

test('three slots per provider preserve legacy IDs and reject the fourth', () => {
  let saved = {};
  for (const provider of ['gdrive', 's3']) {
    for (let i = 1; i <= 3; i++) saved = add(saved, provider, i);
    assert.throws(() => add(saved, provider, 4), /Tối đa 3/);
  }
  assert.equal(storageConnections(saved).length, 6);
  assert.equal(saved.gdrive.folderId, 'folder-1');
  assert.equal(saved.s3.bucket, 'bucket-1');
  assert.equal(storagePolicy({ ...saved, multiStorage: true }, 'pro').writeChain.length, 7);
  assert.equal(storagePolicy({ ...saved, multiStorage: true }, 'free').writeChain.length, 1);
  assert.throws(() => add(add({}, 'gdrive', 1), 'gdrive', 2, 'free'), error => error.status === 403);
});

test('updates keep IDs, protect historical locations, and reject duplicate targets', () => {
  let saved = add(add({}, 'gdrive', 1), 'gdrive', 2);
  assert.throws(() => add(saved, 'gdrive', 2), /đã được kết nối/);
  assert.throws(() => saveStorageConnection(saved, 'gdrive', { folderId: 'different' }, { connectionId: 'gdrive-2' }), /giữ dữ liệu cũ/);
  assert.throws(() => saveStorageConnection(saved, 's3', {}, { connectionId: 'gdrive-2' }), /không khớp/);
  saved = saveStorageConnection(saved, 'gdrive', { folderId: 'folder-2', refreshToken: 'renewed' }, { connectionId: 'gdrive-2', name: 'Renewed', plan: 'free' });
  assert.equal(storageConnections(saved).length, 2);
  assert.equal(saved.connections[0].config.refreshToken, 'renewed');
  assert.equal(saved.gdrive.refreshToken, 'private-1');
});

async function database() {
  const pg = new PGlite();
  await pg.exec('CREATE TABLE account_integrations (account_id TEXT, provider TEXT, encrypted_config TEXT, updated_at TIMESTAMP, PRIMARY KEY(account_id, provider)); CREATE TABLE accounts (id TEXT PRIMARY KEY, plan TEXT, subscription_status TEXT);');
  await pg.exec("INSERT INTO accounts VALUES ('owner', 'pro', 'active')");
  return { pg, env: { CUSTOMER_SECRETS_KEY: Buffer.alloc(32, 5).toString('base64'), DB_CLIENT: pgliteClient(pg), EVENTS_BUCKET: {} } };
}

test('concurrent encrypted saves enforce cap without losing connections; public API hides credentials', async () => {
  const { pg, env } = await database();
  try {
    const results = await Promise.allSettled([1, 2, 3, 4].map(i => updateIntegration(env, 'owner', 'storage', saved => add(saved, 'gdrive', i))));
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 3);
    assert.match(results.find(item => item.status === 'rejected').reason.message, /Tối đa 3/);
    const saved = await getIntegration(env, 'owner', 'storage');
    assert.equal(storageConnections(saved).length, 3);
    const response = await onRequestGet({ env, data: { accountId: 'owner' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.connections.length, 3);
    assert.ok(!JSON.stringify(body).includes('private-'));
    assert.equal(await getIntegration(env, 'other', 'storage'), null);
  } finally { await pg.close(); }
});

test('S3 uploads, playback and deletes use the selected slot and reject unknown IDs', async () => {
  const { pg, env } = await database();
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    await setIntegration(env, 'owner', 'storage', add(add({}, 's3', 1), 's3', 2));
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), method: options.method, authorization: new Headers(options.headers).get('authorization') });
      return new Response(options.method === 'GET' ? 'video' : null, { status: 200 });
    };
    await putObject(env, 'owner', 's3-2', 'owner/video.mp4', new Uint8Array([1]), 'video/mp4');
    await getObject(env, 'owner', 's3-2', 'owner/video.mp4');
    await deleteObjects(env, 'owner', 's3-2', ['owner/video.mp4']);
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.ok(request.url.includes('bucket-2'));
      assert.ok(request.authorization.includes('key-2'));
    }
    await assert.rejects(() => getObject(env, 'owner', 's3-missing', 'owner/video.mp4'), /không còn khả dụng/);
    await assert.rejects(() => getObject(env, 'owner', 'bad-provider', 'owner/video.mp4'), /không hợp lệ/);
    await assert.rejects(() => getObject(env, 'other', 's3-2', 'owner/video.mp4'), /không còn khả dụng/);
  } finally { globalThis.fetch = originalFetch; await pg.close(); }
});
