#!/usr/bin/env node
// Renders go2rtc.yaml from apps/relay/cameras.json — one go2rtc per site,
// one stream entry per camera at that site, stream name = camera.id.
const fs = require("fs");
const path = require("path");
const { sourceUrls } = require("../../apps/relay/src/camera-config");

const camerasPath = path.resolve(__dirname, "../../apps/relay/cameras.json");
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

const outPath = path.resolve(__dirname, "go2rtc.yaml");
fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Đã ghi ${outPath}`);
