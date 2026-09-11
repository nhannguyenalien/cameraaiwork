#!/usr/bin/env node
// Renders go2rtc.yaml from apps/relay/cameras.json — one go2rtc per site,
// one stream entry per camera at that site, stream name = camera.id.
const fs = require("fs");
const path = require("path");
const { sourceUrls } = require("../../apps/relay/src/camera-config");

const camerasPath = path.resolve(__dirname, "../../apps/relay/cameras.json");
const envPath = path.resolve(__dirname, "../../apps/relay/.env");

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

// Existing process variables take precedence. Reading the dotenv file here is
// safer than sourcing it from a shell because values may contain spaces.
const runtimeEnv = { ...readDotEnv(envPath), ...process.env };
if (!fs.existsSync(camerasPath)) {
  console.error(
    `Không tìm thấy ${camerasPath}. Copy apps/relay/cameras.json.example -> cameras.json trước.`
  );
  process.exit(1);
}

const cameras = JSON.parse(fs.readFileSync(camerasPath, "utf8"));

const lines = ["streams:"];
for (const cam of cameras) {
  lines.push(`  ${cam.id}:`);
  for (const source of sourceUrls({ ...cam, rtsp: cam.rtsp || { port: 554, path: "/stream1" } })) {
    lines.push(`    - ${JSON.stringify(source)}`);
  }
}

// go2rtc is never a public origin. cloudflared reaches the relay only; the
// relay validates a signed live token (or its machine secret) before proxying
// a request to this loopback listener.
lines.push("");
lines.push("api:");
lines.push('  listen: "127.0.0.1:1984"');

// WebRTC media should connect peer-to-peer when possible and use the shared
// TURN service only as a fallback. Installations without TURN settings keep
// go2rtc's normal STUN/direct behaviour.
lines.push("");
lines.push("webrtc:");
const webrtcListen = runtimeEnv.GO2RTC_WEBRTC_LISTEN || "127.0.0.1:8555";
if (!/^(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(webrtcListen)) {
  throw new Error("GO2RTC_WEBRTC_LISTEN không hợp lệ");
}
lines.push(`  listen: ${JSON.stringify(webrtcListen)}`);
if (runtimeEnv.TURN_URL && runtimeEnv.TURN_USERNAME && runtimeEnv.TURN_PASSWORD) {
  const urls = [runtimeEnv.TURN_URL];
  if (runtimeEnv.TURNS_URL) urls.push(runtimeEnv.TURNS_URL);
  lines.push("  ice_servers:");
  lines.push('    - urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"]');
  lines.push(`    - urls: ${JSON.stringify(urls)}`);
  lines.push(`      username: ${JSON.stringify(runtimeEnv.TURN_USERNAME)}`);
  lines.push(`      credential: ${JSON.stringify(runtimeEnv.TURN_PASSWORD)}`);
}

const outPath = path.resolve(__dirname, "go2rtc.yaml");
fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Đã ghi ${outPath}`);
