import { getDb } from "../../_lib/db.js";
import { accountUsage } from "../../_lib/plans.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const summary = await accountUsage(env, data.accountId);
  return json({
    plan: summary.plan,
    videoRetentionDays: summary.videoRetentionDays,
    clipDurationSeconds: summary.clipDurationSeconds,
    maxVideoRetentionDays: summary.limits.maxVideoRetentionDays,
  });
});

export const onRequestPut = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  if (!body || (body.videoRetentionDays === undefined && body.clipDurationSeconds === undefined)) return errorJson("Không có cài đặt để cập nhật", 400);
  const summary = await accountUsage(env, data.accountId);
  const updates = [];
  if (body.videoRetentionDays !== undefined) {
    const days = Number(body.videoRetentionDays);
    if (!Number.isSafeInteger(days) || days < 1) return errorJson("Thời gian lưu video phải là số ngày từ 1 trở lên", 400);
    if (summary.plan !== "pro" && days !== 7) return errorJson("Gói Free cố định thời gian lưu video là 7 ngày", 402);
    if (days > summary.limits.maxVideoRetentionDays) return errorJson(summary.plan === "pro" ? "Gói Pro chỉ hỗ trợ lưu video dưới 1 năm" : "Gói Free lưu video tối đa 7 ngày", 402);
    updates.push({ sql: "UPDATE accounts SET video_retention_days = ? WHERE id = ?", args: [days, data.accountId] });
  }
  if (body.clipDurationSeconds !== undefined) {
    const duration = Number(body.clipDurationSeconds);
    if (!summary.limits.clipDurations.includes(duration)) return errorJson("Thời lượng clip này chỉ dành cho gói Pro", 402);
    const db = getDb(env);
    const current = await db.execute({ sql: "SELECT clip_duration_seconds FROM accounts WHERE id = ?", args: [data.accountId] });
    updates.push({ sql: "UPDATE accounts SET clip_duration_seconds = ? WHERE id = ?", args: [duration, data.accountId] });
    if (current.rows[0]?.clip_duration_seconds == null) updates.push({ sql: "UPDATE cameras SET clip_duration_seconds = NULL WHERE account_id = ?", args: [data.accountId] });
  }
  await getDb(env).batch(updates);
  const saved = await accountUsage(env, data.accountId);
  return json({ ok: true, videoRetentionDays: saved.videoRetentionDays, clipDurationSeconds: saved.clipDurationSeconds });
});
