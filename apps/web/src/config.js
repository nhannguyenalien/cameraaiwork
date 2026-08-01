const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../../..");

// Load .env from the repo root regardless of the process's working
// directory, so this works the same run via `npm run dev` or via a
// launchd/systemd service with an arbitrary WorkingDirectory.
require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 3021),

  camera: {
    ip: required("CAMERA_IP", "192.168.2.23"),
    onvifPort: Number(process.env.CAMERA_ONVIF_PORT || 2020),
    username: required("CAMERA_USERNAME", "changeme"),
    password: required("CAMERA_PASSWORD", "changeme"),
  },

  go2rtc: {
    // Used server-side (Node -> go2rtc), can stay localhost even behind a tunnel.
    internalUrl: process.env.GO2RTC_URL || "http://localhost:1984",
    // Used by the browser (iframe/player). In production this is the public
    // tunnel hostname (e.g. Cloudflare Tunnel), not localhost.
    publicUrl: process.env.PUBLIC_GO2RTC_URL || process.env.GO2RTC_URL || "http://localhost:1984",
    stream: process.env.GO2RTC_STREAM || "tapo",
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  },

  db: {
    path: process.env.DB_PATH || path.join(REPO_ROOT, "data", "camera_history.db"),
  },

  // Optional: URL of the local Python AI worker (apps/ai/worker). If unset,
  // every motion event is treated as an alert (old behavior) — nothing
  // breaks if the AI worker isn't deployed yet.
  aiWorker: {
    url: process.env.AI_WORKER_URL || "",
    timeoutMs: Number(process.env.AI_WORKER_TIMEOUT_MS || 3000),
  },
};
