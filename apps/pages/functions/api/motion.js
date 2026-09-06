// Webhook receiver: called by a site's relay (apps/relay) whenever go2rtc
// reports motion on one of its cameras. Body: { siteId, camera }.
// Authenticated per-site (not per-account — the relay holds a site secret,
// not a customer API key; see _middleware.js and getSiteUnscoped).
import { getDb } from "../_lib/db.js";
import { getCameraByStreamUnscoped, getSiteUnscoped } from "../_lib/sites.js";
import { getFrame } from "../_lib/go2rtc.js";
import { detectPerson } from "../_lib/detection.js";
import { findOrCreatePerson } from "../_lib/faceMatch.js";
import { sendPhotoAlert } from "../_lib/telegram.js";
import { captureClip, uploadClip, uploadSnapshot } from "../_lib/r2.js";
import { getIntegration } from "../_lib/integrations.js";
import { json, errorJson, withErrorHandling } from "../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env, waitUntil }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const { siteId, camera } = body;
  if (!siteId || !camera) {
    return errorJson("siteId và camera là bắt buộc", 400);
  }

  const site = await getSiteUnscoped(env, siteId);
  if (!site || request.headers.get("x-relay-secret") !== site.relay_secret) {
    return errorJson("Unauthorized", 401);
  }

  const cameraConfig = await getCameraByStreamUnscoped(env, site.id, camera);
  if (!cameraConfig) return errorJson("Camera not found", 404);

  // Open the MP4 stream before the slower snapshot/AI/Telegram/DB path only
  // when this camera is configured to retain person-event video.
  const shouldRecord = Number(cameraConfig.record_on_person ?? 1) === 1;
  const clipPromise = shouldRecord ? captureClip(site, camera) : null;
  const frame = await getFrame(env, site, camera);
  const { hasPerson, faceEmbedding } = await detectPerson(env, site, frame);

  if (!hasPerson) {
    return json({ ok: true, alerted: false });
  }

  const personId = await findOrCreatePerson(env, site.account_id, faceEmbedding);

  const caption = `🔔 Phát hiện người (${site.name || site.id})!\n⏰ ${new Date().toLocaleString("vi-VN")}`;
  const telegram = await getIntegration(env, site.account_id, "telegram");
  const link = await sendPhotoAlert(telegram, frame, caption);

  const db = getDb(env);
  const inserted = await db.execute({
    sql: "INSERT INTO events (account_id, site_id, camera, person_id, type, video_link, video_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [site.account_id, site.id, camera, personId, "Person", link, shouldRecord ? "recording" : "disabled"],
  });
  const eventId = Number(inserted.lastInsertRowid);

  // The event is already durable at this point. Snapshot and clip persistence
  // are independent so a broken video stream never removes the event/photo.
  waitUntil(
    uploadSnapshot(env, frame, `${site.account_id}/${eventId}.jpg`)
      .then((key) => db.execute({ sql: "UPDATE events SET image_key = ? WHERE id = ?", args: [key, eventId] }))
      .catch((err) => console.error(`Upload snapshot thất bại (${eventId}):`, err.message || err))
  );

  // Capture + upload happens after the response below (via waitUntil) because
  // recording and uploading the finite clip takes several seconds.
  if (shouldRecord) {
    waitUntil(
      uploadClip(env, clipPromise, `${site.account_id}/${eventId}.mp4`)
        .then((key) => db.execute({
          sql: "UPDATE events SET video_key = ?, video_status = 'ready', video_error = NULL WHERE id = ?",
          args: [key, eventId],
        }))
        .catch((err) => {
          const message = String(err.message || "Không lưu được clip").slice(0, 300);
          console.error(`Lưu clip thất bại (${eventId}):`, message);
          return db.execute({
            sql: "UPDATE events SET video_status = 'error', video_error = ? WHERE id = ?",
            args: [message, eventId],
          });
        })
    );
  }

  return json({ ok: true, alerted: true, personId });
});
