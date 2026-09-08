import { getDb } from "../_lib/db.js";
import { findOrCreatePerson } from "../_lib/faceMatch.js";
import { getSiteUnscoped } from "../_lib/sites.js";
import { errorJson, json, withErrorHandling } from "../_lib/http.js";

async function authenticate(request, env, siteId) {
  if (!siteId) return null;
  const site = await getSiteUnscoped(env, siteId);
  return site && request.headers.get("x-relay-secret") === site.relay_secret ? site : null;
}

export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId") || "";
  const site = await authenticate(request, env, siteId);
  if (!site) return errorJson("Unauthorized", 401);
  const db = getDb(env);

  if (url.searchParams.get("action") === "media") {
    const eventId = Number(url.searchParams.get("eventId"));
    const kind = url.searchParams.get("kind") === "video" ? "video" : "image";
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return errorJson("eventId không hợp lệ", 400);
    const result = await db.execute({
      sql: "SELECT image_key, video_key FROM events WHERE id = ? AND site_id = ? AND account_id = ?",
      args: [eventId, site.id, site.account_id],
    });
    const key = kind === "video" ? result.rows[0]?.video_key : result.rows[0]?.image_key;
    if (!key) return errorJson("Không tìm thấy media", 404);
    const object = await env.EVENTS_BUCKET.get(key);
    if (!object) return errorJson("Không tìm thấy object R2", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": kind === "video" ? "video/mp4" : "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const requested = Number(url.searchParams.get("limit") || 5);
  const limit = Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : 5));
  const candidates = await db.execute({
    sql: `SELECT id, image_key, video_key, timestamp
          FROM events
          WHERE site_id = ? AND account_id = ?
            AND (image_key IS NOT NULL OR video_key IS NOT NULL)
            AND (face_scan_status IS NULL OR face_scan_status IN ('pending', 'error')
                 OR (face_scan_status = 'processing' AND face_scan_started_at < CURRENT_TIMESTAMP - INTERVAL '20 minutes'))
          ORDER BY timestamp ASC LIMIT ?`,
    args: [site.id, site.account_id, limit],
  });
  const events = [];
  for (const row of candidates.rows) {
    const claimed = await db.execute({
      sql: `UPDATE events SET face_scan_status = 'processing', face_scan_started_at = CURRENT_TIMESTAMP, face_scan_error = NULL
            WHERE id = ? AND site_id = ?
              AND (face_scan_status IS NULL OR face_scan_status IN ('pending', 'error')
                   OR (face_scan_status = 'processing' AND face_scan_started_at < CURRENT_TIMESTAMP - INTERVAL '20 minutes'))
            RETURNING id`,
      args: [row.id, site.id],
    });
    if (claimed.rows.length) events.push({
      id: Number(row.id),
      hasImage: Boolean(row.image_key),
      hasVideo: Boolean(row.video_key),
      timestamp: row.timestamp,
    });
  }
  return json({ events });
});

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const body = await request.json();
  const site = await authenticate(request, env, body.siteId || "");
  if (!site) return errorJson("Unauthorized", 401);
  const eventId = Number(body.eventId);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return errorJson("eventId không hợp lệ", 400);
  const db = getDb(env);
  const event = await db.execute({
    sql: "SELECT id FROM events WHERE id = ? AND site_id = ? AND account_id = ?",
    args: [eventId, site.id, site.account_id],
  });
  if (!event.rows.length) return errorJson("Event not found", 404);

  if (body.error) {
    await db.execute({
      sql: "UPDATE events SET face_scan_status = 'error', face_scan_error = ? WHERE id = ?",
      args: [String(body.error).slice(0, 500), eventId],
    });
    return json({ ok: true, retry: true });
  }

  const detections = (Array.isArray(body.faceEmbeddings) ? body.faceEmbeddings : []).slice(0, 20).map((face) => ({
    embedding: Array.isArray(face) ? face : face?.embedding,
    box: !Array.isArray(face) && Array.isArray(face?.box) && face.box.length === 4 ? face.box : null,
  }));
  const personIds = [];
  const personBoxes = new Map();
  for (const detection of detections) {
    const id = await findOrCreatePerson(env, site.account_id, detection.embedding);
    if (id && !personIds.includes(id)) personIds.push(id);
    if (id && detection.box && !personBoxes.has(id)) personBoxes.set(id, detection.box);
  }
  for (const personId of personIds) {
    await db.execute({
      sql: "INSERT INTO event_people (event_id, person_id, face_box) VALUES (?, ?, ?) ON CONFLICT (event_id, person_id) DO UPDATE SET face_box = COALESCE(event_people.face_box, EXCLUDED.face_box)",
      args: [eventId, personId, personBoxes.has(personId) ? JSON.stringify(personBoxes.get(personId)) : null],
    });
    // A retry or deliberate historical rescan must not inflate seen_count.
    // Derive all counters from the durable event links after the upsert.
    await db.execute({
      sql: `UPDATE people SET
              seen_count = (SELECT COUNT(*) FROM event_people WHERE person_id = ?),
              first_seen_at = COALESCE((SELECT MIN(e.timestamp) FROM event_people ep JOIN events e ON e.id = ep.event_id WHERE ep.person_id = ?), first_seen_at),
              last_seen_at = COALESCE((SELECT MAX(e.timestamp) FROM event_people ep JOIN events e ON e.id = ep.event_id WHERE ep.person_id = ?), last_seen_at)
            WHERE id = ?`,
      args: [personId, personId, personId, personId],
    });
  }
  await db.execute({
    sql: `UPDATE events SET person_id = COALESCE(person_id, ?), face_scan_status = 'completed',
          face_scanned_at = CURRENT_TIMESTAMP, face_scan_error = NULL WHERE id = ?`,
    args: [personIds[0] || null, eventId],
  });
  return json({ ok: true, personIds });
});
