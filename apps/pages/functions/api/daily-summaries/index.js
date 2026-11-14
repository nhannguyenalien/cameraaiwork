import { getDb } from "../../_lib/db.js";
import { generateDailySummary, yesterday } from "../../_lib/dailySummary.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const result = await getDb(env, "api.daily-summaries").execute({
    sql: `SELECT s.id, s.day::text AS day, s.camera, c.name AS camera_name, s.status, s.clip_count, s.event_count, s.narration, s.error, s.finished_at
          FROM daily_summaries s LEFT JOIN cameras c ON c.id = s.camera AND c.account_id = s.account_id
          WHERE s.account_id = ? ORDER BY s.day DESC, (s.camera <> '') ASC, c.name ASC LIMIT 60`,
    args: [data.accountId],
  });
  return json({ summaries: result.rows });
});

// POST {day?: "YYYY-MM-DD", camera?: cameraId} builds the summary now (default: yesterday, whole system).
export const onRequestPost = withErrorHandling(async ({ request, env, data, waitUntil }) => {
  const body = await request.json().catch(() => ({}));
  const day = body.day || yesterday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return errorJson("day phải có dạng YYYY-MM-DD", 400);
  const camera = String(body.camera || "");
  if (camera) {
    const owned = await getDb(env, "api.daily-summaries").execute({ sql: "SELECT 1 FROM cameras WHERE id = ? AND account_id = ?", args: [camera, data.accountId] });
    if (!owned.rows.length) return errorJson("Camera không tồn tại", 404);
  }
  const running = await getDb(env, "api.daily-summaries").execute({
    sql: "SELECT 1 FROM daily_summaries WHERE account_id = ? AND day = ?::date AND camera = ? AND status = 'running' AND created_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes'",
    args: [data.accountId, day, camera],
  });
  if (running.rows.length) return errorJson("Đang tạo video tóm tắt cho ngày này", 409);
  waitUntil(generateDailySummary(env, data.accountId, day, {}, camera));
  return json({ started: true, day, camera }, { status: 202 });
});
