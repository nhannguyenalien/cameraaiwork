import { measureDb } from "./dbMetrics.js";
import postgres from "postgres";

function postgresSql(sql) {
  let index = 0;
  return sql
    .replace(/datetime\('now','localtime'\)/g, "CURRENT_TIMESTAMP")
    .replace(/datetime\('now', '\+15 minutes'\)/g, "CURRENT_TIMESTAMP + INTERVAL '15 minutes'")
    .replace(/datetime\('now'\)/g, "CURRENT_TIMESTAMP")
    .replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO")
    .replace(/\?/g, () => `$${++index}`);
}

function normalize(statement) {
  if (typeof statement === "string") return { sql: postgresSql(statement), args: [] };
  return { sql: postgresSql(statement.sql), args: statement.args || [] };
}

function resultShape(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { rows: list, rowsAffected: list.length, lastInsertRowid: list[0]?.id };
}

// Hyperdrive (env.HYPERDRIVE) pools connections to the Coolify Postgres;
// DATABASE_URL is the direct fallback for local dev and scripts.
export function connect(env) {
  if (env.DB_CLIENT) return env.DB_CLIENT; // test seam (see test/helpers/pgliteClient.mjs)
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url) throw new Error("Thiếu HYPERDRIVE hoặc DATABASE_URL cho PostgreSQL");
  return postgres(url, { max: 5, fetch_types: false, idle_timeout: 20 });
}

export function getDb(env, flow = "other") {
  const sql = connect(env);

  return {
    async execute(statement) {
      const query = normalize(statement);
      return resultShape(await measureDb(env, flow, query.sql, () => sql.unsafe(query.sql, query.args)));
    },
    async batch(statements) {
      const queries = statements.map(normalize);
      const results = await measureDb(env, flow, queries.map(q => q.sql).join(";"), () => sql.begin(
        (tx) => queries.map((query) => tx.unsafe(query.sql, query.args)),
      ));
      return results.map(resultShape);
    },
    close: () => sql.end(),
  };
}
