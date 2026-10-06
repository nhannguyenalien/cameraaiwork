import { measureDb } from "./dbMetrics.js";
import { neon } from "@neondatabase/serverless";

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

// Neon's default (non-fullResults) mode returns a bare row array, which skips
// the per-query field metadata and keeps the HTTP payload smaller.
function resultShape(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { rows: list, rowsAffected: list.length, lastInsertRowid: list[0]?.id };
}

export function getDb(env, flow = "other") {
  if (!env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL cho Neon PostgreSQL");
  const sql = neon(env.DATABASE_URL);

  return {
    async execute(statement) {
      const query = normalize(statement);
      return resultShape(await measureDb(env, flow, query.sql, () => sql.query(query.sql, query.args)));
    },
    async batch(statements) {
      const queries = statements.map(normalize);
      const results = await measureDb(env, flow, queries.map(q => q.sql).join(";"), () => sql.transaction(
        (tx) => queries.map((query) => tx.query(query.sql, query.args)),
      ));
      return results.map(resultShape);
    },
  };
}
