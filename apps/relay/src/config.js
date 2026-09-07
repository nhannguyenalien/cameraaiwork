const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const camerasPath = path.resolve(__dirname, "../cameras.json");
if (!fs.existsSync(camerasPath)) {
  throw new Error(
    `Không tìm thấy ${camerasPath}. Copy cameras.json.example -> cameras.json và điền thông tin camera.`
  );
}
const cameras = JSON.parse(fs.readFileSync(camerasPath, "utf8"));

// Use an explicit IPv4 loopback. On Ubuntu, `localhost` commonly resolves to
// ::1 first while go2rtc may only be listening on 127.0.0.1.
const go2rtcUrl = process.env.GO2RTC_URL || "http://127.0.0.1:1984";
const pagesApiUrl = (process.env.PAGES_API_URL || "").replace(/\/$/, "");

module.exports = {
  port: Number(process.env.RELAY_PORT || 4000),
  relaySecret: process.env.RELAY_SECRET || "",
  siteId: process.env.SITE_ID || "",

  go2rtc: {
    url: go2rtcUrl,
    port: Number(new URL(go2rtcUrl).port || 1984),
  },
  aiWorkerUrl: process.env.AI_WORKER_URL || "http://127.0.0.1:8001",
  // Cameras with broken ONVIF PullPoint support can still trigger alerts by
  // periodically running the local person detector against a snapshot.
  personPollIntervalMs: Number(process.env.PERSON_POLL_INTERVAL_MS || 5000),
  tapoTalkbackPassword: process.env.TAPO_TALKBACK_PASSWORD || "",
  tapoGreeting: process.env.TAPO_GREETING || "Xin chào",
  tapoGreetingCooldownMs: Number(process.env.TAPO_GREETING_COOLDOWN_MS || 60000),

  pagesApiUrl,
  // Both derived from PAGES_API_URL — override individually only if the
  // installer's defaults don't fit (e.g. testing against a preview deploy).
  motionWebhookUrl: process.env.MOTION_WEBHOOK_URL || (pagesApiUrl && `${pagesApiUrl}/api/motion`),
  siteUpdateUrl: pagesApiUrl && `${pagesApiUrl}/api/sites/${process.env.SITE_ID || ""}`,

  // Set by the installer from POST /api/sites. MVP sites require a named
  // tunnel; there is intentionally no public Quick Tunnel fallback.
  cloudflareTunnelToken: process.env.CLOUDFLARE_TUNNEL_TOKEN || "",

  cameras, // [{ id, stream, onvif: { ip, port, username, password } }, ...]
  camerasPath,
};
