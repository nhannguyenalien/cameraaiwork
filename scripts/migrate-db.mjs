import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/pages/package.json", import.meta.url));
const { createClient } = require("@libsql/client");

const url = process.env.TURSO_DB_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const tunnelBaseDomain = process.env.TUNNEL_BASE_DOMAIN;
if (!url || !authToken) {
  throw new Error("Thiếu TURSO_DB_URL hoặc TURSO_AUTH_TOKEN");
}

const db = createClient({ url, authToken });

async function columns(table) {
  const result = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(result.rows.map((row) => String(row.name)));
}

async function addColumn(table, name, definition) {
  const existing = await columns(table);
  if (existing.has(name)) {
    console.log(`= ${table}.${name} đã có`);
    return;
  }
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  console.log(`+ ${table}.${name}`);
}

await addColumn("events", "video_key", "TEXT");
await addColumn("cameras", "record_on_person", "INTEGER NOT NULL DEFAULT 1");
await addColumn("sites", "ai_worker_url", "TEXT");
await addColumn("accounts", "plan", "TEXT NOT NULL DEFAULT 'free'");
await addColumn("accounts", "subscription_status", "TEXT NOT NULL DEFAULT 'inactive'");
await addColumn("accounts", "stripe_customer_id", "TEXT");
await addColumn("accounts", "stripe_subscription_id", "TEXT");

const authColumns = await columns("auth_credentials");
if (authColumns.size > 0 && !authColumns.has("password_salt")) {
  const count = await db.execute("SELECT COUNT(*) AS count FROM auth_credentials");
  if (Number(count.rows[0].count) > 0) {
    throw new Error("auth_credentials dùng schema cũ và đã có dữ liệu; cần migrate tài khoản thủ công trước khi tiếp tục");
  }
  await db.execute("DROP TABLE auth_credentials");
  console.log("~ auth_credentials schema cũ rỗng đã được thay thế");
}

await db.execute(`
  CREATE TABLE IF NOT EXISTS auth_credentials (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS account_integrations (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    provider TEXT NOT NULL,
    encrypted_config TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, provider)
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS install_tokens (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
await db.execute("CREATE INDEX IF NOT EXISTS idx_install_tokens_account ON install_tokens(account_id)");

if (tunnelBaseDomain) {
  await db.execute({
    sql: `UPDATE sites
          SET ai_worker_url = 'https://' || id || '.' || ? || '/internal/ai'
          WHERE cloudflare_tunnel_id IS NOT NULL
            AND (ai_worker_url IS NULL
              OR ai_worker_url = ''
              OR ai_worker_url LIKE 'https://%-ai.%')`,
    args: [tunnelBaseDomain],
  });
  console.log("= sites.ai_worker_url đã hội tụ về hostname duy nhất");
} else {
  console.warn("! Thiếu TUNNEL_BASE_DOMAIN; bỏ qua hội tụ sites.ai_worker_url");
}

console.log("Database migration hoàn tất.");
db.close();
