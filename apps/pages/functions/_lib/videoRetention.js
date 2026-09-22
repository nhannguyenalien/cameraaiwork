import { getDb } from "./db.js";
import { deleteObjects } from "./objectStorage.js";

export async function cleanupExpiredVideos(env, batchSize = 250) {
  const db = getDb(env);
  const limit = Math.min(Math.max(Number(batchSize) || 250, 1), 1000);
  const result = await db.execute({
    sql: `SELECT e.id, e.account_id, e.video_key, e.storage_backend
      FROM events e
      JOIN accounts a ON a.id = e.account_id
      WHERE e.video_key IS NOT NULL
        AND e.timestamp < CURRENT_TIMESTAMP - ((CASE
          WHEN a.plan = 'pro' AND a.subscription_status IN ('active', 'trialing')
            THEN LEAST(GREATEST(COALESCE(a.video_retention_days, 7), 1), 364)
          ELSE 7
        END) * INTERVAL '1 day')
      ORDER BY e.timestamp ASC
      LIMIT ?`,
    args: [limit],
  });

  const groups = new Map();
  for (const row of result.rows) {
    const groupKey = `${row.account_id}:${row.storage_backend || "r2"}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }

  let deleted = 0;
  const errors = [];
  for (const rows of groups.values()) {
    const { account_id: accountId, storage_backend: backend = "r2" } = rows[0];
    try {
      await deleteObjects(env, accountId, backend, rows.map((row) => row.video_key));
      await db.batch(rows.map((row) => ({
        sql: "UPDATE events SET video_key = NULL, video_status = 'expired', video_error = NULL WHERE id = ? AND video_key = ?",
        args: [row.id, row.video_key],
      })));
      deleted += rows.length;
    } catch (error) {
      console.error(`[video-retention] account=${accountId} backend=${backend}:`, error.message || error);
      errors.push({ accountId, backend, count: rows.length });
    }
  }
  return { scanned: result.rows.length, deleted, errors };
}
