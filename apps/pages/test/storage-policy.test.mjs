import assert from 'node:assert/strict';
import test from 'node:test';
import { storagePolicy } from '../functions/_lib/storagePolicy.js';
const saved = { backend: 'gdrive', gdrive: { refreshToken: 'secret' }, s3: { bucket: 'videos' }, multiStorage: true, writeOrder: ['gdrive', 's3', 'r2'] };
test('Pro uses configured priority and Free cannot write to multiple providers', () => {
  assert.deepEqual(storagePolicy(saved, 'pro').writeChain, ['gdrive', 's3', 'r2']);
  assert.deepEqual(storagePolicy(saved, 'free').writeChain, ['gdrive']);
  assert.deepEqual(storagePolicy(saved, 'free').available, ['gdrive', 's3', 'r2']);
  assert.equal(saved.s3.bucket, 'videos');
});
test('pool is opt-in even for Pro and respects R2 priority', () => {
  assert.deepEqual(storagePolicy({ ...saved, multiStorage: false }, 'pro').writeChain, ['gdrive']);
  assert.deepEqual(storagePolicy({ ...saved, writeOrder: ['r2', 's3', 'gdrive'] }, 'pro').writeChain, ['r2', 's3', 'gdrive']);
});
test('unconfigured destinations, duplicates and unavailable R2 are excluded', () => {
  assert.deepEqual(storagePolicy({ s3: {}, writeOrder: ['gdrive', 's3', 's3', 'r2'], multiStorage: true }, 'pro', false).writeChain, ['s3']);
  assert.deepEqual(storagePolicy(null, 'free', false).writeChain, []);
  assert.deepEqual(storagePolicy(null).writeChain, ['r2']);
});
test('legacy settings retain selected destination without exposing credentials', () => {
  const result = storagePolicy({ backend: 's3', s3: { secretAccessKey: 'secret' }, gdrive: {} }, 'free');
  assert.deepEqual(result.writeChain, ['s3']);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

import { encryptConfig, decryptConfig } from '../functions/_lib/integrations.js';
import { onRequestPut } from '../functions/api/settings/storage-config.js';
import { resolveStorageChain } from '../functions/_lib/objectStorage.js';
test('API blocks Free pool activation; Pro priority persists and downgrade gates actual writes', async () => {
  let account = { plan: 'free', subscription_status: 'active' };
  const env = { CUSTOMER_SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'), EVENTS_BUCKET: {} };
  let encrypted = await encryptConfig(env, saved);
  env.DB_CLIENT = { unsafe: async (sql, args) => {
    if (sql.includes('SELECT encrypted_config')) return [{ encrypted_config: encrypted }];
    if (sql.includes('SELECT plan')) return [account];
    if (sql.includes('INSERT INTO account_integrations')) { encrypted = args[2]; return []; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const update = (body) => onRequestPut({ env, data: { accountId: 'account-1' }, request: new Request('https://example.test', { method: 'PUT', body: JSON.stringify(body) }) });
  const body = { action: 'pool', multiStorage: true, order: ['s3', 'gdrive', 'r2'] };
  assert.equal((await update(body)).status, 403);
  account = { plan: 'pro', subscription_status: 'active' };
  assert.equal((await update({ ...body, order: ['s3', 's3', 'r2'] })).status, 400);
  assert.equal((await update(body)).status, 200);
  assert.deepEqual(await resolveStorageChain(env, 'account-1'), body.order);
  account.subscription_status = 'canceled';
  assert.deepEqual(await resolveStorageChain(env, 'account-1'), ['s3']);
  const retained = await decryptConfig(env, encrypted);
  assert.equal(retained.gdrive.refreshToken, 'secret');
  assert.equal(retained.s3.bucket, 'videos');
});
