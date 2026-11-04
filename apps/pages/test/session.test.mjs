import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteClient } from './helpers/pgliteClient.mjs';
import { createAccount, login } from '../functions/_lib/auth.js';
import { sessionCookie, clearSessionCookie, WEB_SESSION_SECONDS } from '../functions/_lib/session.js';

test('signup and login sessions remain valid for 30 days, matching the secure cookie', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, email TEXT, plan TEXT, subscription_status TEXT);
      CREATE TABLE auth_credentials (account_id TEXT, password_salt TEXT, password_hash TEXT, password_iterations INTEGER);
      CREATE TABLE api_keys (id TEXT, account_id TEXT, label TEXT, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);
    `);
    const env = { DB_CLIENT: pgliteClient(pg), DB_METRICS: '0' };
    const credentials = { email: 'session@example.com', password: 'test-password-long-enough' };
    const signup = await createAccount(env, credentials);
    const signedIn = await login(env, credentials);
    assert.equal(signedIn.accountId, signup.accountId);
    const { rows } = await pg.query(`SELECT EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)) AS remaining FROM api_keys WHERE revoked_at IS NULL`);
    assert.equal(rows.length, 2);
    assert.equal(WEB_SESSION_SECONDS, 2592000);
    for (const row of rows) assert.ok(Math.abs(Number(row.remaining) - WEB_SESSION_SECONDS) < 10);
    assert.match(sessionCookie(signedIn.apiKey), /Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict/);
    assert.match(clearSessionCookie(), /Max-Age=0/);
  } finally { await pg.close(); }
});
