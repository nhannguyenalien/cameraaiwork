import { getDb } from "./db.js";

export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({ sites: 3, cameras: 10, viewersPerCamera: 1, clipDurations: [10], maxVideoRetentionDays: 7 }),
  pro: Object.freeze({ sites: 10, cameras: null, viewersPerCamera: 5, clipDurations: [10, 30, 60], maxVideoRetentionDays: 364 }),
});

export function limitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export async function accountUsage(env, accountId) {
  const db = getDb(env);
  const [accountResult, siteResult, cameraResult] = await Promise.all([
    db.execute({ sql: "SELECT plan, subscription_status, video_retention_days FROM accounts WHERE id = ?", args: [accountId] }),
    db.execute({ sql: "SELECT COUNT(*) AS count FROM sites WHERE account_id = ?", args: [accountId] }),
    db.execute({ sql: "SELECT COUNT(*) AS count FROM cameras WHERE account_id = ?", args: [accountId] }),
  ]);
  const account = accountResult.rows[0] || { plan: "free", subscription_status: "inactive" };
  const effectivePlan = account.plan === "pro" && ["active", "trialing"].includes(account.subscription_status) ? "pro" : "free";
  const limits = limitsFor(effectivePlan);
  const savedRetention = Number(account.video_retention_days) || 7;
  return {
    plan: effectivePlan,
    subscriptionStatus: account.subscription_status,
    limits,
    videoRetentionDays: Math.min(Math.max(savedRetention, 1), limits.maxVideoRetentionDays),
    usage: { sites: Number(siteResult.rows[0].count), cameras: Number(cameraResult.rows[0].count) },
  };
}

export function normalizeClipDuration(plan, value) {
  const allowed = limitsFor(plan).clipDurations;
  const duration = Number(value);
  return allowed.includes(duration) ? duration : 10;
}

export function effectivePlanForAccountRow(account = {}) {
  return account.plan === "pro" && ["active", "trialing"].includes(account.subscription_status) ? "pro" : "free";
}

export async function effectivePlanForAccount(env, accountId) {
  const result = await getDb(env).execute({
    sql: "SELECT plan, subscription_status FROM accounts WHERE id = ?",
    args: [accountId],
  });
  return effectivePlanForAccountRow(result.rows[0]);
}

export async function assertCapacity(env, accountId, resource) {
  const summary = await accountUsage(env, accountId);
  const limit = summary.limits[resource];
  if (limit !== null && summary.usage[resource] >= limit) {
    const error = new Error(`Đã đạt giới hạn ${summary.limits[resource]} ${resource} của gói ${summary.plan}`);
    error.status = 402;
    throw error;
  }
  return summary;
}
