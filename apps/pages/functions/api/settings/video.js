import { getDb } from "../../_lib/db.js";
import { accountUsage } from "../../_lib/plans.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const summary = await accountUsage(env, data.accountId);
  return json({
    plan: summary.plan,
    videoRetentionDays: summary.videoRetentionDays,
    maxVideoRetentionDays: summary.limits.maxVideoRetentionDays,
  });
});

export const onRequestPut = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  const days = Number(body?.videoRetentionDays);
  if (!Number.isSafeInteger(days) || days < 1) return errorJson("Thời gian lưu video phải là số ngày từ 1 trở lên", 400);
  const summary = await accountUsage(env, data.accountId);
  if (summary.plan !== "pro" && days !== 7) return errorJson("Gói Free cố định thời gian lưu video là 7 ngày", 402);
  if (days > summary.limits.maxVideoRetentionDays) {
    return errorJson(summary.plan === "pro" ? "Gói Pro chỉ hỗ trợ lưu video dưới 1 năm" : "Gói Free lưu video tối đa 7 ngày", 402);
  }
  await getDb(env).execute({ sql: "UPDATE accounts SET video_retention_days = ? WHERE id = ?", args: [days, data.accountId] });
  return json({ ok: true, videoRetentionDays: days });
});
