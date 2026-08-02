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

const go2rtcUrl = process.env.GO2RTC_URL || "http://localhost:1984";
const pagesApiUrl = (process.env.PAGES_API_URL || "").replace(/\/$/, "");

module.exports = {
  port: Number(process.env.RELAY_PORT || 4000),
  relaySecret: process.env.RELAY_SECRET || "",
  siteId: process.env.SITE_ID || "",

  go2rtc: {
    url: go2rtcUrl,
    port: Number(new URL(go2rtcUrl).port || 1984),
  },

  pagesApiUrl,
  // Both derived from PAGES_API_URL — override individually only if the
  // installer's defaults don't fit (e.g. testing against a preview deploy).
  motionWebhookUrl: process.env.MOTION_WEBHOOK_URL || (pagesApiUrl && `${pagesApiUrl}/api/motion`),
  siteUpdateUrl: pagesApiUrl && `${pagesApiUrl}/api/sites/${process.env.SITE_ID || ""}`,

  // Set by the installer from POST /api/sites' response when the backend
  // provisioned a real named tunnel. If empty, falls back to Quick Tunnels.
  cloudflareTunnelToken: process.env.CLOUDFLARE_TUNNEL_TOKEN || "",

  cameras, // [{ id, stream, onvif: { ip, port, username, password } }, ...]
};
