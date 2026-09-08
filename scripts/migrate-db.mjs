import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/pages/package.json", import.meta.url));
const { neon } = require("@neondatabase/serverless");
const { createClient } = require("@libsql/client");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Thiếu DATABASE_URL của Neon");

const pg = neon(databaseUrl, { fullResults: true });
const schema = await readFile(new URL("../apps/pages/schema.sql", import.meta.url), "utf8");
const statements = schema
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) await pg.query(statement);
console.log(`= Neon schema sẵn sàng (${statements.length} statements)`);

const tursoUrl = process.env.TURSO_DB_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (tursoUrl && tursoToken) {
  const turso = createClient({ url: tursoUrl, authToken: tursoToken });
  const tables = [
    "accounts",
    "auth_credentials",
    "api_keys",
    "install_tokens",
    "account_integrations",
    "sites",
    "cameras",
    "people",
    "events",
    "event_people",
    "jobs",
  ];

  for (const table of tables) {
    let source;
    try {
      source = await turso.execute(`SELECT * FROM ${table}`);
    } catch (error) {
      console.warn(`! Bỏ qua ${table}: ${error.message}`);
      continue;
    }
    if (!source.rows.length) {
      console.log(`= ${table}: 0 rows`);
      continue;
    }

    const columns = source.columns;
    const names = columns.map((name) => `"${name}"`).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const insert = `INSERT INTO "${table}" (${names}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    for (const row of source.rows) {
      await pg.query(insert, columns.map((column) => row[column]));
    }
    console.log(`+ ${table}: ${source.rows.length} rows`);
  }

  const eventCount = await pg.query("SELECT COUNT(*)::int AS count FROM events");
  if (eventCount.rows[0].count > 0) {
    await pg.query("SELECT setval(pg_get_serial_sequence('events', 'id'), (SELECT MAX(id) FROM events), true)");
  }
  await pg.query(`
    INSERT INTO event_people (event_id, person_id)
    SELECT id, person_id FROM events WHERE person_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
  turso.close();
  console.log("= Dữ liệu Turso đã được sao chép sang Neon");
}

if (process.env.TUNNEL_BASE_DOMAIN) {
  await pg.query(
    `UPDATE sites
       SET ai_worker_url = 'https://' || id || '.' || $1 || '/internal/ai'
     WHERE cloudflare_tunnel_id IS NOT NULL
       AND (ai_worker_url IS NULL OR ai_worker_url = '' OR ai_worker_url LIKE 'https://%-ai.%')`,
    [process.env.TUNNEL_BASE_DOMAIN],
  );
}

console.log("Database migration hoàn tất.");
