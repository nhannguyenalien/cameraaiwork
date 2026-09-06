import { getCamera } from "../../../_lib/sites.js";
import { getDb } from "../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  return json({
    cameraId: camera.id,
    siteId: camera.site_id,
    stream: camera.stream,
    name: camera.name,
    recordOnPerson: Boolean(Number(camera.record_on_person)),
  });
});

export const onRequestPatch = withErrorHandling(async ({ request, params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const body = await request.json().catch(() => null);
  const name = String(body?.name || "").trim();
  if (!name || name.length > 120) return errorJson("Tên camera phải có từ 1 đến 120 ký tự", 400);
  await getDb(env).execute({
    sql: "UPDATE cameras SET name = ? WHERE id = ? AND site_id = ? AND account_id = ?",
    args: [name, camera.id, params.site, data.accountId],
  });
  return json({ ok: true, name });
});

export const onRequestDelete = withErrorHandling(async ({ params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const db = getDb(env);
  const events = await db.execute({
    sql: "SELECT image_key, video_key FROM events WHERE account_id = ? AND site_id = ? AND camera = ?",
    args: [data.accountId, params.site, camera.stream],
  });
  if (env.EVENTS_BUCKET) {
    const keys = events.rows.flatMap((row) => [row.image_key, row.video_key]).filter(Boolean);
    if (keys.length) await env.EVENTS_BUCKET.delete(keys);
  }
  await db.batch([
    {
      sql: "DELETE FROM events WHERE account_id = ? AND site_id = ? AND camera = ?",
      args: [data.accountId, params.site, camera.stream],
    },
    {
      sql: "DELETE FROM cameras WHERE id = ? AND site_id = ? AND account_id = ?",
      args: [camera.id, params.site, data.accountId],
    },
  ]);
  return json({ ok: true });
});
