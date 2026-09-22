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
import { triggerGpuScan } from "../_lib/gpuWorker.js";
import { resolveStorageChain } from "../_lib/objectStorage.js";
import { effectivePlanForAccount, normalizeClipDuration } from "../_lib/plans.js";

export const onRequestPost = withErrorHandling(async ({ request, env, waitUntil }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const { siteId, camera, trusted, detection } = body;
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
  const plan = shouldRecord ? await effectivePlanForAccount(env, site.account_id) : "free";
  const clipSeconds = normalizeClipDuration(plan, cameraConfig.clip_duration_seconds);
  const clipPromise = shouldRecord ? captureClip(site, camera, clipSeconds) : null;
  const frame = await getFrame(env, site, camera);
  // A camera the relay marked onvifMotionTrusted already made the person
  // call itself (reliable ONVIF motion feed, see apps/relay/src/index.js).
  // Skip the AI round trip — it's what actually runs the local PC's AI
  // worker — instead of re-confirming a decision that camera already made.
  // Trade-off: no face embedding is produced, so these events won't be
  // matched to a known person (personId stays null).
  const trustedResult = trusted === true && detection &&
    typeof detection.hasPerson === "boolean" && typeof detection.hasVehicle === "boolean"
    ? {
        hasPerson: detection.hasPerson,
        hasVehicle: detection.hasVehicle,
        faceEmbedding: null,
        faceEmbeddings: [],
        faceDetections: [],
      }
    : null;
  const { hasPerson, hasVehicle = false, faceEmbedding, faceEmbeddings = [], faceDetections = [] } = trusted === true
    ? (trustedResult || { hasPerson: true, hasVehicle: false, faceEmbedding: null, faceEmbeddings: [], faceDetections: [] })
    : await detectPerson(env, site, frame);

  if (!hasPerson && !hasVehicle) {
    return json({ ok: true, alerted: false });
  }

  const detections = faceDetections.length
    ? faceDetections
    : (faceEmbeddings.length ? faceEmbeddings : (faceEmbedding ? [faceEmbedding] : []))
        .map((embedding) => ({ embedding, box: null }));
  const personIds = [];
  const personBoxes = new Map();
  // Match sequentially so two very similar faces in one frame can see a row
  // created earlier in this same request instead of producing duplicates.
  for (const detection of detections) {
    const id = await findOrCreatePerson(env, site.account_id, detection.embedding);
    if (id && !personIds.includes(id)) personIds.push(id);
    if (id && detection.box && !personBoxes.has(id)) personBoxes.set(id, detection.box);
  }
  const personId = personIds[0] || null;

  const eventType = hasPerson ? "Person" : "Vehicle";
  const caption = `🔔 Phát hiện ${hasPerson ? "người" : "xe"} (${site.name || site.id})!\n⏰ ${new Date().toLocaleString("vi-VN")}`;
  const telegram = await getIntegration(env, site.account_id, "telegram");
  const link = await sendPhotoAlert(telegram, frame, caption);
  // Chain order: the account's selected backend first, the other
  // configured customer backend as fallback, R2 always last as the
  // guaranteed backstop (see objectStorage.js resolveStorageChain).
  // storage_backend below is a placeholder until the upload actually
  // lands — it's corrected to whichever candidate succeeded once the
  // snapshot/clip upload resolves (see the waitUntil blocks below).
  const storageChain = await resolveStorageChain(env, site.account_id);

  const db = getDb(env);
  const inserted = await db.execute({
    sql: "INSERT INTO events (account_id, site_id, camera, person_id, type, video_link, storage_backend, video_status, face_scan_status, face_scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP) RETURNING id",
    args: [site.account_id, site.id, camera, personId, eventType, link, storageChain[0], shouldRecord ? "recording" : "disabled"],
  });
  const eventId = Number(inserted.lastInsertRowid);
  for (const id of personIds) {
    await db.execute({
      sql: "INSERT INTO event_people (event_id, person_id, face_box) VALUES (?, ?, ?) ON CONFLICT (event_id, person_id) DO UPDATE SET face_box = COALESCE(event_people.face_box, EXCLUDED.face_box)",
      args: [eventId, id, personBoxes.has(id) ? JSON.stringify(personBoxes.get(id)) : null],
    });
  }

  // The event is already durable at this point. Snapshot and clip persistence
  // are independent so a broken video stream never removes the event/photo.
  // They must still land on the same storage_backend (one column covers the
  // whole event row), so the clip upload below waits for the snapshot's
  // fallback decision and tries that backend first. If the snapshot upload
  // fails on every candidate (only possible if R2 itself is broken, since
  // it's always last in the chain), the clip independently runs the full
  // chain — the two could then diverge, but that only happens alongside a
  // platform-level R2 outage.
  let resolveSnapshotBackend;
  const snapshotBackendKnown = new Promise((resolve) => { resolveSnapshotBackend = resolve; });

  waitUntil(
    uploadSnapshot(env, site.account_id, storageChain, frame, `${site.account_id}/${eventId}.jpg`)
      .then(async ({ key, backend }) => {
        resolveSnapshotBackend(backend);
        await db.execute({ sql: "UPDATE events SET image_key = ?, storage_backend = ? WHERE id = ?", args: [key, backend, eventId] });
        if (backend === "r2") await triggerGpuScan(env, eventId);
      })
      .catch((err) => {
        resolveSnapshotBackend(null);
        console.error(`Upload snapshot thất bại (${eventId}):`, err.message || err);
      })
  );

  // Capture + upload happens after the response below (via waitUntil) because
  // recording and uploading the finite clip takes several seconds.
  if (shouldRecord) {
    waitUntil(
      snapshotBackendKnown
        .then((snapshotBackend) => {
          const clipChain = snapshotBackend ? [snapshotBackend, ...storageChain.filter((b) => b !== snapshotBackend)] : storageChain;
          return uploadClip(env, site.account_id, clipChain, clipPromise, `${site.account_id}/${eventId}.mp4`);
        })
        .then(({ key, backend }) => db.execute({
          sql: "UPDATE events SET video_key = ?, storage_backend = ?, video_status = 'ready', video_error = NULL WHERE id = ?",
          args: [key, backend, eventId],
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

  return json({ ok: true, alerted: true, type: eventType, personId, personIds });
});
