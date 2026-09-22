import { getCamera } from "../../../../_lib/sites.js";
import { getDb } from "../../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";
import { accountUsage, normalizeClipDuration } from "../../../../_lib/plans.js";

export const onRequestPatch = withErrorHandling(async ({ request, params, env, data }) => {
  const body = await request.json().catch(() => null);
  if (!body || (body.recordOnPerson === undefined && body.clipDurationSeconds === undefined)) return errorJson("Không có cài đặt để cập nhật", 400);
  if (body.recordOnPerson !== undefined && typeof body.recordOnPerson !== "boolean") return errorJson("recordOnPerson phải là true hoặc false", 400);

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  const summary = await accountUsage(env, data.accountId);
  const requestedDuration = body.clipDurationSeconds === undefined ? Number(camera.clip_duration_seconds) || 10 : Number(body.clipDurationSeconds);
  const duration = normalizeClipDuration(summary.plan, requestedDuration);
  if (duration !== requestedDuration) return errorJson("Thời lượng clip này chỉ dành cho gói Pro", 402);
  const recordOnPerson = body.recordOnPerson === undefined ? Boolean(Number(camera.record_on_person)) : body.recordOnPerson;
  await getDb(env).execute({
    sql: "UPDATE cameras SET record_on_person = ?, clip_duration_seconds = ? WHERE id = ? AND site_id = ? AND account_id = ?",
    args: [recordOnPerson ? 1 : 0, duration, camera.id, params.site, data.accountId],
  });
  return json({ ok: true, recordOnPerson, clipDurationSeconds: duration });
});
