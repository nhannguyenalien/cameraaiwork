import { getDb } from "../../_lib/db.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";
import { deleteObjects } from "../../_lib/objectStorage.js";

export const onRequestDelete = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.ids)) return errorJson("ids phải là một mảng", 400);
  const ids = [...new Set(body.ids)].filter((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0).map(Number);
  if (!ids.length || ids.length > 100) return errorJson("ids phải chứa từ 1 đến 100 event hợp lệ", 400);
  const placeholders = ids.map(() => "?").join(",");
  const db = getDb(env);
  const found = await db.execute({
    sql: `SELECT id, image_key, video_key, storage_backend FROM events WHERE account_id = ? AND id IN (${placeholders})`,
    args: [data.accountId, ...ids],
  });
  for (const backend of ["r2", "s3", "gdrive"]) {
    const keys = found.rows.filter((row) => (row.storage_backend || "r2") === backend).flatMap((row) => [row.image_key, row.video_key]).filter(Boolean);
    await deleteObjects(env, data.accountId, backend, keys);
  }
  if (found.rows.length) {
    const ownedIds = found.rows.map((row) => Number(row.id));
    await db.execute({
      sql: `DELETE FROM events WHERE account_id = ? AND id IN (${ownedIds.map(() => "?").join(",")})`,
      args: [data.accountId, ...ownedIds],
    });
  }
  return json({ ok: true, deleted: found.rows.length });
});
