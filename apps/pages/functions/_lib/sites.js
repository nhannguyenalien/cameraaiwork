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

export async function listCameras(env, accountId) {
  const db = getDb(env);
  const result = await db.execute({
    sql: `
      SELECT cameras.id as cameraId, cameras.stream, cameras.name as cameraName,
             sites.id as siteId, sites.name as siteName, sites.go2rtc_url as go2rtcUrl
      FROM cameras
      JOIN sites ON sites.id = cameras.site_id
      WHERE cameras.account_id = ?
      ORDER BY sites.id, cameras.id
    `,
    args: [accountId],
  });
  return result.rows;
}
