const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

function exec(program, args) {
  return new Promise((resolve, reject) => {
    execFile(program, args, (error) => (error ? reject(error) : resolve()));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTalkback({ go2rtcUrl, password, greeting, cooldownMs = 60000 }) {
  const lastSpoken = new Map();
  const active = new Set();

  async function request(method, pathname, params) {
    const url = new URL(pathname, go2rtcUrl);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
    const response = await fetch(url, { method });
    const body = await response.text();
    if (!response.ok) throw new Error(`go2rtc HTTP ${response.status}: ${body.slice(0, 160)}`);
    return body;
  }

  async function speak(camera) {
    if (!password || !camera?.onvif?.ip) return false;
    const now = Date.now();
    if (active.has(camera.id) || now - (lastSpoken.get(camera.id) || 0) < cooldownMs) return false;

    active.add(camera.id);
    const safeId = String(camera.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const stream = `${safeId}_tapo_talkback`;
    const aiff = path.join(os.tmpdir(), `${stream}.aiff`);
    const wav = path.join(os.tmpdir(), `${stream}.wav`);
    try {
      // The on-site relay currently runs on macOS. Tapo talkback expects
      // low-bandwidth PCMA/8000, so synthesize locally and transcode once.
      await exec("/usr/bin/say", ["-v", "Linh", "-o", aiff, greeting]);
      await exec("/opt/homebrew/opt/ffmpeg@5/bin/ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", aiff, "-ar", "8000", "-ac", "1", wav,
      ]);

      await request("DELETE", "/api/streams", { src: stream }).catch(() => {});
      await request("PATCH", "/api/streams", {
        name: stream,
        src: `tapo://${encodeURIComponent(password)}@${camera.onvif.ip}`,
      });
      await sleep(1500);
      await request("POST", "/api/streams", {
        dst: stream,
        src: `ffmpeg:${wav}#audio=pcma#input=file`,
      });
      lastSpoken.set(camera.id, now);
      await sleep(3000);
      return true;
    } finally {
      await request("DELETE", "/api/streams", { src: stream }).catch(() => {});
      for (const file of [aiff, wav]) fs.promises.unlink(file).catch(() => {});
      active.delete(camera.id);
    }
  }

  return { speak };
}

module.exports = { createTalkback };
