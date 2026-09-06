import { getDb } from "./db.js";
import { randomId, randomSecret, sha256Hex } from "./ids.js";

const encoder = new TextEncoder();
// Cloudflare Workers rejects PBKDF2 iteration counts above 100,000.
const PASSWORD_PBKDF2_ITERATIONS = 100000;

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((value) => parseInt(value, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_PBKDF2_ITERATIONS },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function validateSignupInput({ email, password, name } = {}) {
  if (typeof email !== "string") throw new Error("EMAIL_INVALID");
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error("EMAIL_INVALID");
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 1024) {
    throw new Error("PASSWORD_WEAK");
  }
  const normalizedName = typeof name === "string" ? name.trim().slice(0, 120) : "";
  return { normalizedEmail, password, normalizedName };
}

export function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < 10 || password.length > 1024) {
    throw new Error("PASSWORD_WEAK");
  }
  return password;
}

export function normalizeEmail(email) {
  if (typeof email !== "string") throw new Error("EMAIL_INVALID");
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized) || normalized.length > 254) throw new Error("EMAIL_INVALID");
  return normalized;
}

export async function setLegacyAccountEmail(env, accountId, email) {
  const normalized = normalizeEmail(email);
  const db = getDb(env);
  const current = await db.execute({ sql: "SELECT email FROM accounts WHERE id = ?", args: [accountId] });
  if (!current.rows[0]) throw new Error("ACCOUNT_NOT_FOUND");
  if (current.rows[0].email) return current.rows[0].email;
  const existing = await db.execute({ sql: "SELECT id FROM accounts WHERE email = ? AND id != ?", args: [normalized, accountId] });
  if (existing.rows[0]) throw new Error("EMAIL_EXISTS");
  await db.execute({ sql: "UPDATE accounts SET email = ? WHERE id = ? AND email IS NULL", args: [normalized, accountId] });
  return normalized;
}

export async function updateAccountPassword(env, accountId, password) {
  validateNewPassword(password);
  const db = getDb(env);
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await derivePassword(password, salt);
  await db.execute({
    sql: `INSERT INTO auth_credentials (account_id, password_salt, password_hash, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(account_id) DO UPDATE SET
            password_salt = excluded.password_salt,
            password_hash = excluded.password_hash,
            updated_at = datetime('now')`,
    args: [accountId, salt, passwordHash],
  });
}

export async function createAccount(env, input) {
  const { normalizedEmail, password, normalizedName } = validateSignupInput(input);
  const db = getDb(env);
  const existing = await db.execute({ sql: "SELECT id FROM accounts WHERE email = ?", args: [normalizedEmail] });
  if (existing.rows[0]) throw new Error("EMAIL_EXISTS");

  const accountId = randomId("acct");
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await derivePassword(password, salt);
  const apiKey = randomSecret();
  await db.batch([
    { sql: "INSERT INTO accounts (id, name, email, plan, subscription_status) VALUES (?, ?, ?, 'free', 'inactive')", args: [accountId, normalizedName || normalizedEmail, normalizedEmail] },
    { sql: "INSERT INTO auth_credentials (account_id, password_salt, password_hash) VALUES (?, ?, ?)", args: [accountId, salt, passwordHash] },
    { sql: "INSERT INTO api_keys (id, account_id, label) VALUES (?, ?, 'web signup')", args: [await sha256Hex(apiKey), accountId] },
  ]);
  return { accountId, apiKey };
}

export async function login(env, { email, password }) {
  if (typeof email !== "string" || typeof password !== "string") return null;
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT a.id, c.password_salt, c.password_hash FROM accounts a JOIN auth_credentials c ON c.account_id = a.id WHERE a.email = ?",
    args: [email.trim().toLowerCase()],
  });
  const row = result.rows[0];
  if (!row || !constantTimeEqual(await derivePassword(password, row.password_salt), row.password_hash)) return null;
  const apiKey = randomSecret();
  await db.execute({ sql: "INSERT INTO api_keys (id, account_id, label) VALUES (?, ?, 'web login')", args: [await sha256Hex(apiKey), row.id] });
  return { accountId: row.id, apiKey };
}
