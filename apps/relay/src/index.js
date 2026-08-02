/**
 * Runs on-site, next to one or more cameras. This is the only piece of the
 * system that MUST stay physically near the cameras — everything else (UI,
 * API, DB, AI orchestration, RunPod, multi-tenant accounts) lives on
 * Cloudflare Pages. See docs/ARCHITECTURE.md.
 *
 * Responsibilities, on purpose kept to just these two, for every camera
 * listed in cameras.json:
 *   1. Forward PTZ commands from the Pages Function to the right camera
 *      (ONVIF needs LAN access, can't be done from Cloudflare's edge).
 *   2. Listen for motion directly from the camera's own ONVIF event
 *      service (long-lived pull-point subscription, can't be done from a
 *      stateless edge function) and notify the Pages Function by webhook,
 *      tagged with siteId + camera, when motion happens. No AI, no DB, no
 *      Telegram here — apps/pages/functions/api/motion.js owns all of that.
 *
 *      NOTE: motion used to be watched via go2rtc's `/api/events` — that
 *      endpoint doesn't exist (go2rtc has no motion/event API at all,
 *      confirmed against its actual OpenAPI spec after it 404'd in live
 *      testing). ONVIF event subscription is the architecturally correct
 *      source for this anyway — motion detection is a camera capability,
 *      not something go2rtc does.
 *
 * Also starts a Cloudflare Quick Tunnel for go2rtc and one for itself, and
 * self-reports the resulting URLs to the backend (PATCH /api/sites/:id) —
 * no manual Cloudflare setup needed on-site. Quick Tunnel hostnames change
 * on every restart, so this re-registers every time, not just once.
 */
const express = require("express");
const axios = require("axios");
const config = require("./config");
const ptz = require("./ptz");
const { startQuickTunnel } = require("./tunnel");

const app = express();
app.use(express.json());

function requireSecret(req, res, next) {
  if (!config.relaySecret || req.headers["x-relay-secret"] !== config.relaySecret) {
    return res.sendStatus(401);
  }
  next();
}

app.post("/ptz/:camera/:dir", requireSecret, (req, res) => {
  const { camera, dir } = req.params;
  let ok;
  if (dir === "up") ok = ptz.move(camera, 0, 0.5);
  else if (dir === "down") ok = ptz.move(camera, 0, -0.5);
  else if (dir === "left") ok = ptz.move(camera, -0.5, 0);
  else if (dir === "right") ok = ptz.move(camera, 0.5, 0);
  else if (dir === "stop") ok = ptz.stop(camera);
  else return res.sendStatus(400);

  res.sendStatus(ok ? 200 : 404);
});

app.get("/health", (req, res) => res.json({ ok: true, cameras: config.cameras.map((c) => c.id) }));

const cooldowns = new Map(); // camera id -> bool

async function notifyMotion(cameraId) {
  if (!config.motionWebhookUrl) {
    console.warn("⚠️ MOTION_WEBHOOK_URL chưa cấu hình, bỏ qua.");
    return;
  }
  try {
    await axios.post(
      config.motionWebhookUrl,
      { siteId: config.siteId, camera: cameraId },
      { headers: { "x-relay-secret": config.relaySecret }, timeout: 5000 }
    );
  } catch (e) {
    console.error(`❌ Gửi motion webhook thất bại (${cameraId}):`, e.message);
  }
}

// ONVIF's event topic naming isn't standardized enough across camera
// vendors to safely filter by an exact topic string without risking
// silently missing real motion — so, matching the original code's
// permissive behavior, ANY event from the camera counts as "check it".
// The topic is logged so it can be tightened later once real topic names
// are observed in practice (see docs/PLAN.md).
//
// Some cheap camera firmware (observed on a Tapo C200) advertises ONVIF
// pull-point support but can't actually hold the long-poll HTTP connection
// open for the spec's full timeout — pullMessages fails with "socket hang
// up" every time. The `onvif` package's own retry loop has no backoff, so
// left alone it hammers the camera continuously. This backs off for 15s
// after 5 consecutive failures instead of retrying as fast as possible.
function watchMotionOnvif(cameraId, cam) {
  let consecutiveErrors = 0;

  function onEvent(message) {
    consecutiveErrors = 0;
    const topic = message?.topic?._ || "(unknown topic)";
    console.log(`📡 ONVIF event (${cameraId}): ${topic}`);
    if (cooldowns.get(cameraId)) return;
    cooldowns.set(cameraId, true);
    notifyMotion(cameraId);
    setTimeout(() => cooldowns.set(cameraId, false), 30000); // nghỉ 30s tránh spam webhook
  }

  function onError(err) {
    consecutiveErrors++;
    if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
      console.error(`❌ ONVIF events lỗi (${cameraId}, lần ${consecutiveErrors}):`, err.message || err);
    }
    if (consecutiveErrors >= 5) {
      console.warn(`⏸️  Tạm dừng ONVIF events (${cameraId}) 15s do lỗi liên tục (camera có thể không giữ được long-poll)...`);
      cam.removeListener("event", onEvent);
      cam.removeListener("eventsError", onError);
      setTimeout(() => watchMotionOnvif(cameraId, cam), 15000);
    }
  }

  cam.on("event", onEvent);
  cam.on("eventsError", onError);
}

if (!config.siteId) {
  throw new Error("SITE_ID chưa cấu hình trong .env — phải khớp với sites.id trên Turso.");
}

ptz.connectAll(watchMotionOnvif);
app.listen(config.port, () => console.log(`🚀 Relay (${config.siteId}) chạy ở http://localhost:${config.port}`));

// --- Tunnels + self-registration ---
let currentGo2rtcUrl = null;
let currentRelayUrl = null;

async function reportTunnelUrls() {
  if (!currentGo2rtcUrl || !currentRelayUrl) return;
  if (!config.siteUpdateUrl) {
    console.warn("⚠️ PAGES_API_URL chưa cấu hình, không thể tự đăng ký tunnel URL.");
    return;
  }
  try {
    await axios.patch(
      config.siteUpdateUrl,
      { go2rtcUrl: currentGo2rtcUrl, relayUrl: currentRelayUrl },
      { headers: { "x-relay-secret": config.relaySecret }, timeout: 5000 }
    );
    console.log("✅ Đã cập nhật tunnel URL lên backend.");
  } catch (e) {
    console.error("❌ Cập nhật tunnel URL lên backend thất bại:", e.message);
  }
}

if (config.pagesApiUrl) {
  startQuickTunnel("go2rtc", config.go2rtc.port, (url) => {
    currentGo2rtcUrl = url;
    reportTunnelUrls();
  });
  startQuickTunnel("relay", config.port, (url) => {
    currentRelayUrl = url;
    reportTunnelUrls();
  });
} else {
  console.warn("⚠️ PAGES_API_URL chưa cấu hình — bỏ qua tunnel, chỉ chạy local.");
}
