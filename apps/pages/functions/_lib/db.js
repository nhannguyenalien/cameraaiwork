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

function resultShape(result) {
  return {
    rows: result.rows || [],
    rowsAffected: result.rowCount || 0,
    lastInsertRowid: result.rows?.[0]?.id,
  };
}

export function getDb(env) {
  if (!env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL cho Neon PostgreSQL");
  const sql = neon(env.DATABASE_URL, { fullResults: true });

  return {
    async execute(statement) {
      const query = normalize(statement);
      return resultShape(await sql.query(query.sql, query.args));
    },
    async batch(statements) {
      const queries = statements.map(normalize);
      const results = await sql.transaction(
        (tx) => queries.map((query) => tx.query(query.sql, query.args)),
        { fullResults: true },
      );
      return results.map(resultShape);
    },
  };
}
