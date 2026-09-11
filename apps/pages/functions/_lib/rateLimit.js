import { getDb } from "./db.js";
import { sha256Hex } from "./ids.js";

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() || "unknown";
}

export async function checkAuthRateLimit(env, request, scope, identity, limit, windowMinutes) {
  const key = await sha256Hex(`${scope}:${clientIp(request)}:${String(identity || "").trim().toLowerCase()}`);
  const db = getDb(env);
  const result = await db.execute({
    sql: `INSERT INTO auth_rate_limits (id, attempts, window_started, blocked_until)
          VALUES (?, 1, CURRENT_TIMESTAMP, NULL)
          ON CONFLICT (id) DO UPDATE SET
            attempts = CASE WHEN auth_rate_limits.window_started < CURRENT_TIMESTAMP - (? * INTERVAL '1 minute') THEN 1 ELSE auth_rate_limits.attempts + 1 END,
            window_started = CASE WHEN auth_rate_limits.window_started < CURRENT_TIMESTAMP - (? * INTERVAL '1 minute') THEN CURRENT_TIMESTAMP ELSE auth_rate_limits.window_started END,
            blocked_until = CASE
              WHEN auth_rate_limits.blocked_until > CURRENT_TIMESTAMP THEN auth_rate_limits.blocked_until
              WHEN auth_rate_limits.window_started >= CURRENT_TIMESTAMP - (? * INTERVAL '1 minute') AND auth_rate_limits.attempts + 1 >= ? THEN CURRENT_TIMESTAMP + (? * INTERVAL '1 minute')
              ELSE NULL END
          RETURNING attempts, blocked_until`,
    args: [key, windowMinutes, windowMinutes, windowMinutes, limit, windowMinutes],
  });
  const row = result.rows[0] || {};
  return { allowed: !row.blocked_until, key };
}

export async function clearAuthRateLimit(env, key) {
  await getDb(env).execute({ sql: "DELETE FROM auth_rate_limits WHERE id = ?", args: [key] });
}
