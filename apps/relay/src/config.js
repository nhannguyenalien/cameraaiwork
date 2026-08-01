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

module.exports = {
  port: Number(process.env.RELAY_PORT || 4000),
  relaySecret: process.env.RELAY_SECRET || "",
  siteId: process.env.SITE_ID || "",

  go2rtc: {
    url: process.env.GO2RTC_URL || "http://localhost:1984",
  },

  // Cloudflare Pages Function that receives motion webhooks, e.g.
  // https://cameraaiwork.pages.dev/api/motion
  motionWebhookUrl: process.env.MOTION_WEBHOOK_URL || "",

  cameras, // [{ id, stream, onvif: { ip, port, username, password } }, ...]
};
