import { getDb } from "../../_lib/db.js";
import { generateDailySummary, yesterday } from "../../_lib/dailySummary.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const result = await getDb(env, "api.daily-summaries").execute({
    sql: `SELECT id, day::text AS day, status, clip_count, event_count, error, finished_at
          FROM daily_summaries WHERE account_id = ? ORDER BY day DESC LIMIT 30`,
    args: [data.accountId],
  });
  return json({ summaries: result.rows });
});

// POST {day?: "YYYY-MM-DD"} builds the summary now (default: yesterday).
export const onRequestPost = withErrorHandling(async ({ request, env, data, waitUntil }) => {
  const body = await request.json().catch(() => ({}));
  const day = body.day || yesterday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return errorJson("day phải có dạng YYYY-MM-DD", 400);
  const running = await getDb(env, "api.daily-summaries").execute({
    sql: "SELECT 1 FROM daily_summaries WHERE account_id = ? AND day = ?::date AND status = 'running' AND created_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes'",
    args: [data.accountId, day],
  });
  if (running.rows.length) return errorJson("Đang tạo video tóm tắt cho ngày này", 409);
  waitUntil(generateDailySummary(env, data.accountId, day));
  return json({ started: true, day }, { status: 202 });
});
