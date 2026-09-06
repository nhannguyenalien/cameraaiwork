import { getDb } from "./db.js";

export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({ sites: 1, cameras: 2, viewersPerCamera: 1 }),
  pro: Object.freeze({ sites: 10, cameras: 32, viewersPerCamera: 5 }),
});

export function limitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export async function accountUsage(env, accountId) {
  const db = getDb(env);
  const [accountResult, siteResult, cameraResult] = await Promise.all([
    db.execute({ sql: "SELECT plan, subscription_status FROM accounts WHERE id = ?", args: [accountId] }),
    db.execute({ sql: "SELECT COUNT(*) AS count FROM sites WHERE account_id = ?", args: [accountId] }),
    db.execute({ sql: "SELECT COUNT(*) AS count FROM cameras WHERE account_id = ?", args: [accountId] }),
  ]);
  const account = accountResult.rows[0] || { plan: "free", subscription_status: "inactive" };
  const effectivePlan = account.plan === "pro" && ["active", "trialing"].includes(account.subscription_status) ? "pro" : "free";
  return {
    plan: effectivePlan,
    subscriptionStatus: account.subscription_status,
    limits: limitsFor(effectivePlan),
    usage: { sites: Number(siteResult.rows[0].count), cameras: Number(cameraResult.rows[0].count) },
  };
}

export async function assertCapacity(env, accountId, resource) {
  const summary = await accountUsage(env, accountId);
  if (summary.usage[resource] >= summary.limits[resource]) {
    const error = new Error(`Đã đạt giới hạn ${summary.limits[resource]} ${resource} của gói ${summary.plan}`);
    error.status = 402;
    throw error;
  }
  return summary;
}
