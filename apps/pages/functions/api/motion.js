// Webhook receiver: called by a site's relay (apps/relay) whenever go2rtc
// reports motion on one of its cameras. Body: { siteId, camera }.
// Authenticated per-site (not per-account — the relay holds a site secret,
// not a customer API key; see _middleware.js and getSiteUnscoped).
import { getDb } from "../_lib/db.js";
import { getSiteUnscoped } from "../_lib/sites.js";
import { getFrame } from "../_lib/go2rtc.js";
import { hasPerson } from "../_lib/detection.js";
import { sendPhotoAlert } from "../_lib/telegram.js";
import { json, errorJson, withErrorHandling } from "../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
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

  const frame = await getFrame(env, site, camera);
  const personDetected = await hasPerson(env, frame);

  if (!personDetected) {
    return json({ ok: true, alerted: false });
  }

  const caption = `🔔 Phát hiện người (${site.name || site.id})!\n⏰ ${new Date().toLocaleString("vi-VN")}`;
  const link = await sendPhotoAlert(env, frame, caption);

  const db = getDb(env);
  await db.execute({
    sql: "INSERT INTO events (account_id, site_id, camera, type, video_link) VALUES (?, ?, ?, ?, ?)",
    args: [site.account_id, site.id, camera, "Person", link],
  });

  return json({ ok: true, alerted: true });
});
