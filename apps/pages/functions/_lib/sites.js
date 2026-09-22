import { getDb } from "./db.js";

// Unscoped lookup — only used by the /api/motion webhook, which
// authenticates via the site's own relay_secret rather than an account API
// key (the relay doesn't hold a customer API key). See _middleware.js.
export async function getSiteUnscoped(env, siteId) {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT * FROM sites WHERE id = ?",
    args: [siteId],
  });
  return result.rows[0] || null;
}

export async function getSite(env, accountId, siteId) {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT * FROM sites WHERE id = ? AND account_id = ?",
    args: [siteId, accountId],
  });
  return result.rows[0] || null;
}

// The relay only knows cameras by their go2rtc "stream" key (e.g. "tapo"),
// not the DB's opaque cameraId — this resolves one to the other.
export async function getCamera(env, accountId, siteId, cameraId) {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT * FROM cameras WHERE id = ? AND site_id = ? AND account_id = ?",
    args: [cameraId, siteId, accountId],
  });
  return result.rows[0] || null;
}

export async function getCameraByStreamUnscoped(env, siteId, stream) {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT * FROM cameras WHERE site_id = ? AND stream = ?",
    args: [siteId, stream],
  });
  return result.rows[0] || null;
}

export async function listCameras(env, accountId) {
  const db = getDb(env);
  const result = await db.execute({
    sql: `
      SELECT cameras.id AS "cameraId", cameras.stream, cameras.name AS "cameraName",
             cameras.record_on_person AS "recordOnPerson",
             CASE
               WHEN accounts.plan = 'pro'
                 AND accounts.subscription_status IN ('active', 'trialing')
                 AND COALESCE(cameras.clip_duration_seconds, accounts.clip_duration_seconds, 10) IN (10, 30, 60)
               THEN COALESCE(cameras.clip_duration_seconds, accounts.clip_duration_seconds, 10)
               ELSE 10
             END AS "clipDurationSeconds",
             cameras.clip_duration_seconds AS "clipDurationOverrideSeconds",
             sites.id AS "siteId", sites.name AS "siteName"
      FROM cameras
      JOIN sites ON sites.id = cameras.site_id
      JOIN accounts ON accounts.id = cameras.account_id
      WHERE cameras.account_id = ?
      ORDER BY sites.id, cameras.id
    `,
    args: [accountId],
  });
  return result.rows;
}
