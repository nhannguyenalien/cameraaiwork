import { getCamera, getSite } from "../../../_lib/sites.js";
import { getDb } from "../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../_lib/http.js";
import { validateResourceName } from "../../../_lib/resourceNames.js";
import { deleteObjects } from "../../../_lib/objectStorage.js";
import { accountUsage, normalizeClipDuration } from "../../../_lib/plans.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const summary = await accountUsage(env, data.accountId);
  const override = camera.clip_duration_seconds == null ? null : Number(camera.clip_duration_seconds);
  return json({
    cameraId: camera.id,
    siteId: camera.site_id,
    stream: camera.stream,
    name: camera.name,
    recordOnPerson: Boolean(Number(camera.record_on_person)),
    clipDurationSeconds: normalizeClipDuration(summary.plan, override ?? summary.clipDurationSeconds),
    clipDurationOverrideSeconds: override,
  });
});

export const onRequestPatch = withErrorHandling(async ({ request, params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const body = await request.json().catch(() => null);
  let name;
  try {
    name = validateResourceName(body?.name, "camera");
  } catch (error) {
    return errorJson(error.message, 400);
  }
  await getDb(env).execute({
    sql: "UPDATE cameras SET name = ? WHERE id = ? AND site_id = ? AND account_id = ?",
    args: [name, camera.id, params.site, data.accountId],
  });
  return json({ ok: true, name });
});

export const onRequestDelete = withErrorHandling(async ({ params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const site = await getSite(env, data.accountId, params.site);
  if (site?.relay_url) {
    const relayResponse = await fetch(`${site.relay_url}/config/cameras/${encodeURIComponent(camera.stream)}`, {
      method: "DELETE",
      headers: { "x-relay-secret": site.relay_secret },
    });
    if (!relayResponse.ok && relayResponse.status !== 404) return errorJson("Không xóa được cấu hình camera tại máy site", 502);
  }
  const db = getDb(env);
  const events = await db.execute({
    sql: "SELECT image_key, video_key, storage_backend FROM events WHERE account_id = ? AND site_id = ? AND camera = ?",
    args: [data.accountId, params.site, camera.stream],
  });
  for (const backend of ["r2", "s3", "gdrive"]) {
    const keys = events.rows.filter((row) => (row.storage_backend || "r2") === backend).flatMap((row) => [row.image_key, row.video_key]).filter(Boolean);
    await deleteObjects(env, data.accountId, backend, keys);
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
