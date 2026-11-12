import { getDb } from "./db.js";
import { deleteObjects } from "./objectStorage.js";

// Cloudflare R2 is the shared, free-tier storage backend and the guaranteed
// last resort in the write-path fallback chain (see objectStorage.js
// resolveStorageChain()/putObjectWithFallback()). Paid accounts bring their
// own S3-compatible bucket or Google Drive and are never capped or pruned by
// this module — every function here only ever touches storage_backend='r2'
// rows for the account passed in. ensureR2Capacity() is called from
// putObject() itself, only on the "r2" branch.
export const R2_FREE_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GiB per account

const LIST_PAGE_LIMIT = 1000;
const MAX_LIST_PAGES = 100; // matches storageUsage.js's own cap (~100k objects)
const EVICTION_BATCH = 10;
// Hard stop so a stuck loop (e.g. R2 briefly reporting stale sizes) can
// never hang a request or spiral into deleting an account's entire history.
const MAX_EVICTION_ROUNDS = 20;

export async function r2AccountUsageBytes(env, accountId) {
  if (!env.EVENTS_BUCKET) return 0;
  let usage = 0;
  let cursor;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const listed = await env.EVENTS_BUCKET.list({ prefix: `${accountId}/`, limit: LIST_PAGE_LIMIT, cursor });
    for (const object of listed.objects) usage += Number(object.size || 0);
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return usage;
}

// Called right before writing a new object to the free-tier R2 bucket. If
// the account is at or would go over its 1 GiB cap, deletes its oldest
// events (both the R2 objects and the DB row, cascading to event_people)
// first-in-first-out until the incoming object fits, then returns so the
// caller's own upload can proceed. A currently-recording event is never
// picked (its keys are still NULL at that point), so an in-flight upload
// can't evict itself or another concurrent one.
export async function ensureR2Capacity(env, accountId, incomingBytes) {
  if (!env.EVENTS_BUCKET || !accountId) return;
  const need = Number(incomingBytes) || 0;
  const db = getDb(env, "_lib.storageQuota");

  for (let round = 0; round < MAX_EVICTION_ROUNDS; round += 1) {
    const usage = await r2AccountUsageBytes(env, accountId);
    if (usage + need <= R2_FREE_QUOTA_BYTES) return;

    const oldest = await db.execute({
      sql: `SELECT id, image_key, video_key FROM events
            WHERE account_id = ? AND storage_backend = 'r2'
              AND (image_key IS NOT NULL OR video_key IS NOT NULL)
              AND video_status != 'recording'
            ORDER BY timestamp ASC, id ASC
            LIMIT ?`,
      args: [accountId, EVICTION_BATCH],
    });
    if (!oldest.rows.length) return; // nothing left to reclaim; let the write proceed anyway

    const ids = oldest.rows.map((row) => Number(row.id));
    const keys = oldest.rows.flatMap((row) => [row.image_key, row.video_key]).filter(Boolean).map(String);
    if (keys.length) await deleteObjects(env, accountId, "r2", keys);
    await db.execute({
      sql: `DELETE FROM events WHERE account_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
      args: [accountId, ...ids],
    });
  }
}

// Opt-in (storage integration `autoEvict`): when a customer's Google Drive is
// out of space, delete the oldest *video* clips this app wrote to that backend
// so new recordings keep flowing. Images and event rows are kept; only
// objects referenced by events.video_key are touched, never other Drive files.
const DRIVE_EVICTION_BATCH = 10;
const MAX_DRIVE_EVICTION_ROUNDS = 5;

export async function evictOldestVideos(env, accountId, backend, batch = DRIVE_EVICTION_BATCH) {
  const db = getDb(env, "_lib.storageQuota");
  const oldest = await db.execute({
    sql: `SELECT id, video_key FROM events
          WHERE account_id = ? AND storage_backend = ? AND video_key IS NOT NULL AND video_status != 'recording'
          ORDER BY timestamp ASC, id ASC LIMIT ?`,
    args: [accountId, backend, batch],
  });
  if (!oldest.rows.length) return 0;
  await deleteObjects(env, accountId, backend, oldest.rows.map((row) => String(row.video_key)));
  await db.batch(oldest.rows.map((row) => ({
    sql: "UPDATE events SET video_key = NULL, video_status = 'expired', video_error = NULL WHERE id = ? AND video_key = ?",
    args: [row.id, row.video_key],
  })));
  return oldest.rows.length;
}

export { MAX_DRIVE_EVICTION_ROUNDS };
