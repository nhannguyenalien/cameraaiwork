import { getDb } from "./db.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function encryptionKey(env) {
  if (!env.CUSTOMER_SECRETS_KEY) throw new Error("CUSTOMER_SECRETS_KEY chưa cấu hình");
  const raw = fromBase64(env.CUSTOMER_SECRETS_KEY);
  if (raw.byteLength !== 32) throw new Error("CUSTOMER_SECRETS_KEY phải là 32 byte base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptConfig(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(JSON.stringify(value)));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptConfig(env, value) {
  const [iv, ciphertext] = value.split(".");
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await encryptionKey(env), fromBase64(ciphertext));
  return JSON.parse(decoder.decode(clear));
}

export async function setIntegration(env, accountId, provider, config) {
  const db = getDb(env);
  await db.execute({
    sql: `INSERT INTO account_integrations (account_id, provider, encrypted_config, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(account_id, provider) DO UPDATE SET encrypted_config = excluded.encrypted_config, updated_at = datetime('now')`,
    args: [accountId, provider, await encryptConfig(env, config)],
  });
}

export async function getIntegration(env, accountId, provider) {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT encrypted_config FROM account_integrations WHERE account_id = ? AND provider = ?",
    args: [accountId, provider],
  });
  return result.rows[0] ? decryptConfig(env, result.rows[0].encrypted_config) : null;
}

export async function integrationStatus(env, accountId) {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT provider, updated_at FROM account_integrations WHERE account_id = ?",
    args: [accountId],
  });
  return Object.fromEntries(result.rows.map((row) => [row.provider, { configured: true, updatedAt: row.updated_at }]));
}
