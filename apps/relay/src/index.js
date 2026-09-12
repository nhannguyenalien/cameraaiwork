/**
 * Runs on-site, next to one or more cameras. This is the only piece of the
 * system that MUST stay physically near the cameras — everything else (UI,
 * API, DB, AI orchestration, RunPod, multi-tenant accounts) lives on
 * Cloudflare Pages. See docs/ARCHITECTURE.md.
 *
 * Responsibilities for every camera
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
 *   3. Be the only origin behind the site's named tunnel: authenticated
 *      internal proxy for go2rtc/AI plus signed, camera-scoped live view.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const axios = require("axios");
const http = require("http");
const httpProxy = require("http-proxy");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const config = require("./config");
const ptz = require("./ptz");
const { startNamedTunnel } = require("./tunnel");
const { parseLiveRequest } = require("./live-auth");
const { createViewerLimiter } = require("./viewer-limit");
const { createTalkback } = require("./talkback");
const { validateCamera, publicCamera, sameRtspSource, updateGo2rtc, persistCameras } = require("./camera-config");
const { discoverAll, resolveRtsp } = require("./discovery");
const { createFaceBackfill } = require("./face-backfill");

const app = express();
app.use(express.json());

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });
proxy.on("error", (err, _req, res) => {
  console.error("❌ Local proxy lỗi:", err.message);
  if (res && !res.headersSent) res.writeHead(502);
  if (res && !res.writableEnded) res.end("Bad gateway");
});

function requireSecret(req, res, next) {
  if (!config.relaySecret || req.headers["x-relay-secret"] !== config.relaySecret) {
    return res.sendStatus(401);
  }
  next();
}

const liveAuthOptions = {
  siteId: config.siteId,
  relaySecret: config.relaySecret,
  cameras: config.cameras,
};
const viewers = createViewerLimiter();
const talkback = createTalkback({
  go2rtcUrl: config.go2rtc.url,
  password: config.tapoTalkbackPassword,
  greeting: config.tapoGreeting,
  cooldownMs: config.tapoGreetingCooldownMs,
});

function captureLocalClip(cameraId, durationMs = 10000, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const rtspUrl = `${config.go2rtc.rtspUrl.replace(/\/$/, "")}/${encodeURIComponent(cameraId)}`;
    const outputPath = path.join(os.tmpdir(), `cameraai-clip-${randomUUID()}.mp4`);
    let settled = false;
    let stderr = "";

    // go2rtc's HTTP MP4 endpoint may replay the same completed fragment after
    // a client truncates it. FFmpeg opening go2rtc's RTSP endpoint creates a
    // genuinely new consumer for every event and closes a valid finite MP4.
    //
    // Output goes to a real (seekable) temp file, not a pipe: +faststart
    // needs to seek back and rewrite the moov box at the front once encoding
    // finishes, which a pipe can't support. That's also why this used to
    // write frag_keyframe+empty_moov instead — but that fragmented format
    // isn't playable via a plain HTTP Range GET in AVPlayer/ExoPlayer or a
    // <video src>, which is exactly how /api/events/:id/video serves clips.
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-rtsp_transport", "tcp",
      "-i", rtspUrl,
      "-t", String(durationMs / 1000),
      "-map", "0:v:0", "-c:v", "copy", "-an",
      "-movflags", "+faststart",
      "-f", "mp4", "-y", outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    const cleanup = () => fs.promises.unlink(outputPath).catch(() => {});

    const finish = async (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
      if (err) {
        await cleanup();
        return reject(err);
      }
      try {
        const { size } = await fs.promises.stat(outputPath);
        if (size > maxBytes) {
          await cleanup();
          return reject(new Error("Clip vượt giới hạn dung lượng"));
        }
        const buffer = await fs.promises.readFile(outputPath);
        await cleanup();
        resolve(buffer);
      } catch (readErr) {
        await cleanup();
        reject(readErr);
      }
    };

    const timer = setTimeout(() => finish(new Error("FFmpeg ghi clip quá thời gian")), durationMs + 15000);
    ffmpeg.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    ffmpeg.on("error", (err) => finish(err));
    ffmpeg.on("close", (code) => {
      if (code !== 0) return finish(new Error(`FFmpeg thoát mã ${code}: ${stderr.trim()}`));
      finish();
    });
  });
}

app.use("/internal/go2rtc", requireSecret, (req, res) => {
  proxy.web(req, res, { target: config.go2rtc.url });
});

app.get("/internal/frame.jpeg", requireSecret, async (req, res) => {
  const cameraId = String(req.query.src || "");
  if (!config.cameras.some((camera) => camera.id === cameraId)) {
    return res.status(404).json({ error: "Camera không có trong cấu hình relay", code: "camera_not_configured" });
  }
  try {
    const frame = await axios.get(`${config.go2rtc.url}/api/frame.jpeg`, {
      params: { src: cameraId },
      responseType: "arraybuffer",
      timeout: 10000,
    });
    const jpeg = Buffer.from(frame.data);
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return res.sendStatus(502);
    res.set("Cache-Control", "private, no-store, no-cache, max-age=0");
    res.set("Pragma", "no-cache");
    res.type("image/jpeg").send(jpeg);
  } catch (err) {
    console.error(`❌ Snapshot lỗi (${cameraId}):`, err.message || err);
    const go2rtcUnavailable = ["ECONNREFUSED", "ENOTFOUND"].includes(err.code);
    res.status(502).json({
      error: go2rtcUnavailable ? "Không kết nối được dịch vụ go2rtc" : "Camera đang tắt, mất mạng hoặc RTSP không kết nối được",
      code: go2rtcUnavailable ? "go2rtc_unavailable" : "camera_unreachable",
    });
  }
});

// Return a finite, locally-buffered clip. Buffering beside the camera avoids
// Cloudflare treating go2rtc's never-ending progressive MP4 as a stale/long
// response before the Pages Function uploads it to R2.
app.get("/internal/clip.mp4", requireSecret, async (req, res) => {
  const cameraId = String(req.query.src || "");
  if (!config.cameras.some((camera) => camera.id === cameraId)) return res.sendStatus(404);
  try {
    const clip = await captureLocalClip(cameraId);
    if (!clip.length) return res.sendStatus(502);
    res.set("Cache-Control", "private, no-store, no-cache, max-age=0");
    res.type("video/mp4").send(clip);
  } catch (err) {
    console.error(`❌ Ghi clip lỗi (${cameraId}):`, err.message || err);
    res.sendStatus(502);
  }
});

app.use("/internal/ai", requireSecret, (req, res) => {
  proxy.web(req, res, { target: config.aiWorkerUrl });
});

app.use("/live/:token", async (req, res) => {
  const original = `/live/${req.params.token}${req.url}`;
  const parsed = parseLiveRequest(original, liveAuthOptions);
  if (!parsed) return res.sendStatus(401);
  try {
    // Buffer the small HTTP assets instead of piping go2rtc's response through
    // http-proxy. Named Cloudflare Tunnels can interpret the upstream's
    // connection-close response as a broken origin stream and replace an
    // otherwise valid response with a Cloudflare 502. WebSocket video traffic
    // is still handled by server.on("upgrade") below.
    const upstream = await axios.get(`${config.go2rtc.url}${parsed.path}`, {
      responseType: "arraybuffer",
      timeout: 10000,
      validateStatus: () => true,
    });
    const contentType = upstream.headers["content-type"];
    if (contentType) res.type(contentType);
    res.set("Cache-Control", "private, no-store, no-cache, max-age=0");
    res.status(upstream.status).send(Buffer.from(upstream.data));
  } catch (err) {
    console.error(`❌ Live HTTP proxy lỗi (${parsed.camera}):`, err.message || err);
    res.status(502).send("Bad gateway");
  }
});

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

app.post("/ptz/:camera", requireSecret, async (req, res) => {
  const camera = req.params.camera;
  const action = String(req.body?.action || "");
  const speed = Math.max(0.1, Math.min(Number(req.body?.speed) || 0.5, 1));
  const durationMs = Math.max(100, Math.min(Number(req.body?.durationMs) || 500, 5000));
  let result = false;
  if (action === "up") result = ptz.move(camera, 0, speed, 0, durationMs);
  else if (action === "down") result = ptz.move(camera, 0, -speed, 0, durationMs);
  else if (action === "left") result = ptz.move(camera, -speed, 0, 0, durationMs);
  else if (action === "right") result = ptz.move(camera, speed, 0, 0, durationMs);
  else if (action === "zoomIn") result = ptz.move(camera, 0, 0, speed, durationMs);
  else if (action === "zoomOut") result = ptz.move(camera, 0, 0, -speed, durationMs);
  else if (action === "stop") result = ptz.stop(camera);
  else if (action === "home") result = await ptz.home(camera);
  else if (action === "gotoPreset") result = await ptz.gotoPreset(camera, req.body?.preset);
  else if (action === "setPreset") result = await ptz.setPreset(camera, req.body?.name);
  else return res.status(400).json({ error: "PTZ action không hợp lệ" });
  if (!result) return res.status(409).json({ error: "Camera không hỗ trợ lệnh PTZ này hoặc đang offline" });
  res.json({ ok: true, ...(typeof result === "string" ? { preset: result } : {}) });
});

app.get("/controls/:camera", requireSecret, async (req, res) => {
  const camera = config.cameras.find((item) => item.id === req.params.camera);
  if (!camera) return res.sendStatus(404);
  const detected = ptz.capabilities(camera.id);
  let streamOnline = detected.online;
  if (!streamOnline) {
    try {
      const frame = await axios.get(`${config.go2rtc.url}/api/frame.jpeg`, {
        params: { src: camera.id },
        responseType: "arraybuffer",
        timeout: 5000,
      });
      const jpeg = Buffer.from(frame.data);
      streamOnline = jpeg.length >= 4 && jpeg[0] === 0xff && jpeg[1] === 0xd8;
    } catch {
      streamOnline = false;
    }
  }
  res.json({
    // ONVIF can reject duplicate sessions when several logical channels share
    // one NVR. Use the actual RTSP snapshot as the health fallback so a usable
    // video stream is not incorrectly reported offline.
    online: streamOnline,
    ptz: detected.ptz,
    talk: Boolean(config.tapoTalkbackPassword && camera.onvif?.ip),
    light: detected.light,
  });
});

app.post("/talk/:camera", requireSecret, express.raw({ type: "audio/*", limit: "3mb" }), async (req, res) => {
  const camera = config.cameras.find((item) => item.id === req.params.camera);
  if (!camera) return res.sendStatus(404);
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Audio trống" });
  try {
    const played = await talkback.play(camera, req.body);
    if (!played) return res.status(409).json({ error: "Camera không hỗ trợ đàm thoại" });
    res.json({ ok: true });
  } catch (err) {
    console.error(`❌ Đàm thoại lỗi (${camera.id}):`, err.message || err);
    res.status(502).json({ error: "Không phát được âm thanh qua camera" });
  }
});

app.post("/light/:camera", requireSecret, async (req, res) => {
  const camera = config.cameras.find((item) => item.id === req.params.camera);
  if (!camera) return res.sendStatus(404);
  const ok = await ptz.setLight(camera.id, Boolean(req.body?.enabled));
  if (!ok) return res.status(409).json({ error: "Camera không hỗ trợ điều khiển đèn" });
  res.json({ ok: true });
});

app.get("/health", requireSecret, (req, res) => res.json({ ok: true, cameras: config.cameras.map((c) => c.id) }));

app.post("/discover/cameras", requireSecret, async (_req, res) => {
  try {
    res.json({ cameras: await discoverAll() });
  } catch (error) {
    console.error("❌ Quét ONVIF lỗi:", error.message || error);
    res.status(502).json({ error: "Không quét được camera trong mạng LAN của site" });
  }
});

app.get("/config/cameras/:camera", requireSecret, (req, res) => {
  const camera = config.cameras.find((item) => item.id === req.params.camera);
  if (!camera) return res.sendStatus(404);
  res.json(publicCamera(camera));
});

app.put("/config/cameras/:camera", requireSecret, async (req, res) => {
  const index = config.cameras.findIndex((item) => item.id === req.params.camera);
  const current = index >= 0 ? config.cameras[index] : null;
  try {
    let body = req.body || {};
    const connectionFields = ["ip", "username", "password", "onvifPort", "rtspPort", "rtspPath", "onvifStream"];
    const connectionChanged = !current || body.autoConfigure === true
      || connectionFields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (body.autoConfigure) {
      const rtsp = await resolveRtsp({
        ip: body.ip,
        onvifPort: Number(body.onvifPort || 80),
        username: body.username,
        password: body.password,
      });
      body = { ...body, ...rtsp };
    }
    const camera = validateCamera({ ...body, id: req.params.camera }, current);
    const duplicate = config.cameras.find((item) => item.id !== camera.id && sameRtspSource(item, camera));
    if (duplicate) {
      return res.status(409).json({
        error: `Luồng RTSP này đã tồn tại (${duplicate.id})`,
        code: "duplicate_rtsp_source",
        cameraId: duplicate.id,
      });
    }
    // A policy-only change such as localAiEnabled must not restart or validate
    // the video stream. Otherwise a temporary go2rtc issue can make the toggle
    // appear to save and then jump back to its previous state.
    if (connectionChanged) await updateGo2rtc(config.go2rtc.url, camera);
    if (index >= 0) config.cameras[index] = camera;
    else config.cameras.push(camera);
    persistCameras(config.camerasPath, config.cameras);
    if (!camera.localAiEnabled) stopPersonPolling(camera.id);
    ptz.reconnect(camera, watchMotionOnvif);
    res.json(publicCamera(camera));
  } catch (error) {
    console.error(`❌ Cấu hình camera lỗi (${req.params.camera}):`, error.message);
    res.status(400).json({ error: error.message || "Cấu hình camera không hợp lệ" });
  }
});

app.delete("/config/cameras/:camera", requireSecret, async (req, res) => {
  const index = config.cameras.findIndex((item) => item.id === req.params.camera);
  if (index < 0) return res.sendStatus(404);
  try {
    const url = new URL("/api/streams", config.go2rtc.url);
    url.searchParams.set("src", req.params.camera);
    await fetch(url, { method: "DELETE" });
    config.cameras.splice(index, 1);
    persistCameras(config.camerasPath, config.cameras);
    ptz.remove(req.params.camera);
    stopPersonPolling(req.params.camera);
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: error.message || "Không xóa được camera tại site" });
  }
});

const cooldowns = new Map(); // camera id -> bool
const personPollers = new Map(); // camera id -> interval; ONVIF fallback only
const personPresence = new Map(); // camera id -> { present, missingFrames }

function localAiEnabled(cameraId) {
  return config.cameras.find((item) => item.id === cameraId)?.localAiEnabled !== false;
}

function stopPersonPolling(cameraId) {
  const timer = personPollers.get(cameraId);
  if (timer) clearInterval(timer);
  personPollers.delete(cameraId);
  personPresence.delete(cameraId);
}

async function notifyMotion(cameraId, trusted) {
  if (!config.motionWebhookUrl) {
    console.warn("⚠️ MOTION_WEBHOOK_URL chưa cấu hình, bỏ qua.");
    return;
  }
  try {
    const response = await axios.post(
      config.motionWebhookUrl,
      { siteId: config.siteId, camera: cameraId, trusted: Boolean(trusted) },
      // Pages fetches a fresh frame and asks the on-site AI to confirm the
      // person before inserting the event, unless `trusted` skips that check
      // (camera's own ONVIF motion is trusted, see onvifMotionTrusted below).
      // On a tunnel the AI round trip can exceed 5s.
      { headers: { "x-relay-secret": config.relaySecret }, timeout: 30000 }
    );
    console.log(
      response.data?.alerted
        ? `✅ Đã tạo person event (${cameraId})`
        : `ℹ️ Backend không xác nhận có người (${cameraId})`
    );
  } catch (e) {
    console.error(`❌ Gửi motion webhook thất bại (${cameraId}):`, e.message);
  }
}

function triggerMotion(cameraId, source, trusted = false) {
  if (cooldowns.get(cameraId)) return;
  console.log(`📡 Kích hoạt motion (${cameraId}, ${source})`);
  cooldowns.set(cameraId, true);
  notifyMotion(cameraId, trusted);
  setTimeout(() => cooldowns.set(cameraId, false), 30000);
}

function onvifMotionTrusted(cameraId) {
  return config.cameras.find((item) => item.id === cameraId)?.onvifMotionTrusted === true;
}

// A number of low-cost cameras expose ONVIF/PTZ correctly but abort every
// PullMessages request. Once that failure is proven, poll the local snapshot
// and local AI worker instead. The backend still re-checks the current frame,
// so this only replaces the unreliable motion trigger, not server-side policy.
function startPersonPolling(cameraId) {
  if (!localAiEnabled(cameraId) || personPollers.has(cameraId) || config.personPollIntervalMs <= 0) return;

  const poll = async () => {
    if (!localAiEnabled(cameraId)) {
      stopPersonPolling(cameraId);
      return;
    }
    try {
      const frame = await axios.get(`${config.go2rtc.url}/api/frame.jpeg`, {
        params: { src: cameraId },
        responseType: "arraybuffer",
        timeout: 10000,
      });
      const jpeg = Buffer.from(frame.data);
      if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
        throw new Error("go2rtc trả snapshot không phải JPEG hợp lệ");
      }
      const detected = await axios.post(`${config.aiWorkerUrl}/detect`, jpeg, {
        headers: { "content-type": "image/jpeg" },
        timeout: 20000,
      });
      const camera = config.cameras.find((item) => item.id === cameraId);
      const state = personPresence.get(cameraId) || { present: false, missingFrames: 0 };
      if (detected.data?.hasPerson) {
        triggerMotion(cameraId, "AI polling fallback");
        if (!state.present && camera) {
          state.present = true;
          talkback.speak(camera)
            .then((played) => played && console.log(`🔊 Đã phát lời chào (${cameraId})`))
            .catch((err) => console.error(`❌ Phát lời chào lỗi (${cameraId}):`, err.message || err));
        }
        state.missingFrames = 0;
      } else if (++state.missingFrames >= 3) {
        // Require 3 negative frames before treating the next detection as a
        // new arrival; this avoids repeated greetings from detector flicker.
        state.present = false;
      }
      personPresence.set(cameraId, state);
    } catch (err) {
      console.error(`❌ AI polling lỗi (${cameraId}):`, err.message || err);
    }
  };

  console.warn(`🔄 Bật AI polling fallback cho ${cameraId} mỗi ${config.personPollIntervalMs}ms.`);
  const timer = setInterval(poll, config.personPollIntervalMs);
  personPollers.set(cameraId, timer);
  poll();
}

// Originally this treated ANY ONVIF event as "check it" — topic naming
// isn't standardized enough across vendors to guess a safe filter without
// real data. Now there is real data, from two different cameras: a Tapo
// C200 fires `tns1:RuleEngine/CellMotionDetector/Motion` for actual
// motion (confirmed correct — matched real walking-in-frame tests), while
// a second, unrelated camera fires `tns1:RuleEngine/TamperDetector/Tamper`
// continuously and spuriously (not motion at all — a tamper/obstruction
// sensor false-triggering). CellMotionDetector is also the standard ONVIF
// Profile S motion topic, the most universally supported one — so this
// filters to that specifically now instead of alerting on everything.
// Non-motion topics are still logged, just not treated as motion.
const MOTION_TOPIC = "CellMotionDetector";

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

    if (!topic.includes(MOTION_TOPIC)) {
      console.log(`📡 ONVIF event bỏ qua (${cameraId}, không phải motion): ${topic}`);
      return;
    }

    console.log(`📡 ONVIF motion (${cameraId}): ${topic}`);
    // Most cheap cameras (e.g. Tapo) can emit a burst — or even a continuous
    // stream — of CellMotion events for light/noise changes, not people. By
    // default those unverified events never take the person-event cooldown:
    // they only ensure local AI polling is awake, and the poller calls
    // triggerMotion itself once it confirms hasPerson=true.
    //
    // A camera explicitly marked onvifMotionTrusted (opt-in per camera, see
    // camera-config.js) is assumed to have a reliable motion feed already —
    // for it, skip the local AI check entirely and record straight away.
    // This is the main lever for cutting local PC load: no AI-polling loop
    // ever starts for a trusted camera as long as its ONVIF feed is healthy.
    if (onvifMotionTrusted(cameraId)) {
      triggerMotion(cameraId, "ONVIF motion (trusted)", true);
      return;
    }
    startPersonPolling(cameraId);
  }

  function onError(err) {
    consecutiveErrors++;
    if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
      console.error(`❌ ONVIF events lỗi (${cameraId}, lần ${consecutiveErrors}):`, err.message || err);
    }
    // Tapo PullPoint can remain broken for a long time between retries. Start
    // the snapshot+AI fallback on the first proven error so detection never
    // has a blind window while ONVIF is recovering.
    if (consecutiveErrors === 1) startPersonPolling(cameraId);
    if (consecutiveErrors >= 5) {
      console.warn(`⏸️  Tạm dừng ONVIF events (${cameraId}) 15s do lỗi liên tục (camera có thể không giữ được long-poll)...`);
      startPersonPolling(cameraId);
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

async function reconcileConfiguredStreams() {
  const results = await Promise.allSettled(
    config.cameras.map((camera) => updateGo2rtc(config.go2rtc.url, camera))
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`❌ Không đồng bộ được luồng ${config.cameras[index].id}:`, result.reason?.message || result.reason);
    }
  });
}

// Rebuild go2rtc's dynamic sources on every relay start. This also migrates
// old NVR entries away from the unsafe shared ONVIF video fallback without
// changing anything on the NVR itself.
reconcileConfiguredStreams().finally(() => {
  ptz.connectAll(watchMotionOnvif);
  createFaceBackfill(config).start();
});
const server = app.listen(config.port, "127.0.0.1", () =>
  console.log(`🚀 Relay (${config.siteId}) chạy ở http://127.0.0.1:${config.port}`)
);

server.on("upgrade", (req, socket, head) => {
  const parsed = parseLiveRequest(req.url, liveAuthOptions);
  if (!parsed || !parsed.camera) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!viewers.reserve(parsed.camera, parsed.viewerLimit)) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nRetry-After: 10\r\n\r\n");
    socket.destroy();
    return;
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    viewers.release(parsed.camera);
  };
  socket.once("close", release);
  socket.once("error", release);
  req.url = parsed.path;
  proxy.ws(req, socket, head, { target: config.go2rtc.url });
});

// --- One named tunnel per site ---
if (config.cloudflareTunnelToken) {
  console.log("🚇 Dùng named tunnel một hostname/site.");
  startNamedTunnel(config.cloudflareTunnelToken);
} else {
  console.warn("⚠️ CLOUDFLARE_TUNNEL_TOKEN chưa cấu hình — chỉ chạy local, không tạo Quick Tunnel.");
}
