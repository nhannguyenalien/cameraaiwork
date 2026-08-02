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
 *   2. Watch go2rtc's motion SSE stream per camera (long-lived connections,
 *      can't be done from a stateless edge function) and notify the Pages
 *      Function by webhook, tagged with siteId + camera, when motion
 *      happens. No AI, no DB, no Telegram here — apps/pages/functions/api/motion.js
 *      owns all of that now.
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

async function watchMotion(camera) {
  console.log(`👀 Đang theo dõi chuyển động: ${camera.id}`);
  try {
    const response = await axios({
      method: "get",
      url: `${config.go2rtc.url}/api/events`,
      params: { src: camera.stream },
      responseType: "stream",
      timeout: 0,
    });

    response.data.on("data", (chunk) => {
      const data = chunk.toString();
      if ((data.includes('"on":true') || data.includes("motion")) && !cooldowns.get(camera.id)) {
        cooldowns.set(camera.id, true);
        notifyMotion(camera.id);
        setTimeout(() => cooldowns.set(camera.id, false), 30000); // nghỉ 30s tránh spam webhook
      }
    });

    response.data.on("end", () => setTimeout(() => watchMotion(camera), 5000));
    response.data.on("error", () => setTimeout(() => watchMotion(camera), 5000));
  } catch (e) {
    setTimeout(() => watchMotion(camera), 5000);
  }
}

if (!config.siteId) {
  throw new Error("SITE_ID chưa cấu hình trong .env — phải khớp với sites.id trên Turso.");
}

ptz.connectAll();
config.cameras.forEach(watchMotion);
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
