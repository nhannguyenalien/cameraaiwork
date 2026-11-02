"use strict";
// "Quản gia cổng": on cameras set to high security, talk to whoever walks up.
// Turn-based like a walkie-talkie: greet -> listen for one utterance -> send it
// to the backend (which proxies SchoolsAI STT/AI/TTS) -> play the reply ->
// repeat a few times -> tell the backend the visit is over so the owner gets a
// summary. Half duplex on purpose: the microphone is only opened after the
// speaker has finished, otherwise the camera hears its own voice.
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const axios = require("axios");

const SAMPLE_RATE = 16000;
const FRAME_MS = 20;
const FRAME_BYTES = (SAMPLE_RATE * FRAME_MS / 1000) * 2;

function rms(frame) {
  let sum = 0;
  const samples = frame.length >> 1;
  for (let i = 0; i < samples; i++) {
    const value = frame.readInt16LE(i * 2);
    sum += value * value;
  }
  return samples ? Math.sqrt(sum / samples) : 0;
}

// Energy-based voice activity detection over 16 kHz mono s16le PCM. Resolves
// with the PCM of one utterance, or null when nobody spoke in time.
async function detectUtterance(chunks, {
  waitMs = 6000, maxMs = 8000, endSilenceMs = 900, startMs = 200, calibrateMs = 300, minRms = 250, noiseFactor = 3,
} = {}) {
  let pending = Buffer.alloc(0);
  let elapsed = 0;
  let noise = 0;
  let calibrated = 0;
  let threshold = minRms;
  let speechRun = 0;
  let speaking = false;
  let silenceRun = 0;
  const kept = [];
  const preRoll = [];

  for await (const chunk of chunks) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= FRAME_BYTES) {
      const frame = pending.subarray(0, FRAME_BYTES);
      pending = pending.subarray(FRAME_BYTES);
      elapsed += FRAME_MS;
      const level = rms(frame);
      if (elapsed <= calibrateMs) {
        noise += level;
        calibrated += 1;
        threshold = Math.max(minRms, (noise / calibrated) * noiseFactor);
        continue;
      }
      const loud = level >= threshold;
      if (!speaking) {
        preRoll.push(Buffer.from(frame));
        if (preRoll.length > 10) preRoll.shift();
        speechRun = loud ? speechRun + FRAME_MS : 0;
        if (speechRun >= startMs) { speaking = true; kept.push(...preRoll); silenceRun = 0; }
        else if (elapsed >= waitMs) return null;
      } else {
        kept.push(Buffer.from(frame));
        silenceRun = loud ? 0 : silenceRun + FRAME_MS;
        if (silenceRun >= endSilenceMs || kept.length * FRAME_MS >= maxMs) return Buffer.concat(kept);
      }
    }
  }
  return speaking ? Buffer.concat(kept) : null;
}

function run(program, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    let err = "";
    child.stdout.on("data", (data) => out.push(data));
    child.stderr.on("data", (data) => { err += data; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${program} exit ${code}: ${err.slice(0, 160)}`))));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const encodeOpus = (pcm, ffmpeg = "ffmpeg") => run(ffmpeg, [
  "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-i", "pipe:0",
  "-c:a", "libopus", "-b:a", "24k", "-f", "webm", "pipe:1",
], pcm);

function listenFromCamera(rtspUrl, options = {}, ffmpeg = "ffmpeg") {
  const child = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", rtspUrl,
    "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  const stop = () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };
  child.on("error", stop);
  return detectUtterance(child.stdout, options).finally(stop);
}

function createVoiceGuard({
  config, play, listen = listenFromCamera, encode = encodeOpus, http = axios, log = console,
  visitCooldownMs = 3 * 60 * 1000, policyRefreshMs = 60 * 1000, maxTurns = 4, settleMs = 400,
}) {
  const baseUrl = config.motionWebhookUrl ? new URL(config.motionWebhookUrl) : null;
  const endpoint = (name) => (baseUrl ? new URL(`/api/voice/${name}`, baseUrl).toString() : null);
  const auth = { "x-relay-secret": config.relaySecret };
  const policies = {};
  const lastVisit = new Map();
  const active = new Set();
  let timer = null;

  async function refreshPolicy() {
    if (!baseUrl) return;
    try {
      const { data } = await http.get(baseUrl.toString(), { params: { siteId: config.siteId }, headers: auth, timeout: 10000 });
      for (const [stream, policy] of Object.entries(data?.cameras || {})) policies[stream] = policy;
    } catch (error) { log.warn(`Quản gia: giữ chính sách cũ (${error.message})`); }
  }

  const enabled = (camera) => policies[camera.id]?.gateButler === true;

  const call = (name, camera, visit, body, headers = {}, extra = {}) => http.post(endpoint(name), body, {
    params: { siteId: config.siteId, camera: camera.id, visit },
    headers: { ...auth, ...headers }, timeout: 60000, maxBodyLength: 3 * 1024 ** 2, ...extra,
  });

  async function playBase64(camera, audioBase64) {
    if (!audioBase64) return false;
    return play(camera, Buffer.from(audioBase64, "base64"));
  }

  // Returns true when a visit was started (so the caller skips the fixed greeting).
  async function maybeStart(camera) {
    if (!baseUrl || !enabled(camera) || active.has(camera.id)) return false;
    if (Date.now() - (lastVisit.get(camera.id) || 0) < visitCooldownMs) return false;
    active.add(camera.id);
    lastVisit.set(camera.id, Date.now());
    runVisit(camera).catch((error) => log.error(`❌ Quản gia lỗi (${camera.id}):`, error.message || error))
      .finally(() => active.delete(camera.id));
    return true;
  }

  async function runVisit(camera) {
    const visit = randomUUID();
    const rtspUrl = `${config.go2rtc.rtspUrl.replace(/\/$/, "")}/${encodeURIComponent(camera.id)}`;
    try {
      const { data: greeting } = await call("greeting", camera, visit, null);
      if (!await playBase64(camera, greeting.audioBase64)) return;
      for (let turn = 0; turn < maxTurns; turn++) {
        await new Promise((resolve) => setTimeout(resolve, settleMs));
        const pcm = await listen(rtspUrl);
        if (!pcm) { log.log(`🛎️ Khách im lặng (${camera.id})`); break; }
        const webm = await encode(pcm);
        const { data } = await call("turn", camera, visit, webm, {
          "content-type": "audio/webm", "x-duration-ms": String(Math.round(pcm.length / 2 / SAMPLE_RATE * 1000)),
        });
        await playBase64(camera, data.audioBase64);
        if (data.done) break;
      }
    } finally {
      await call("finish", camera, visit, null).catch((error) => log.warn(`Quản gia: không chốt được lượt ghé (${error.message})`));
    }
  }

  function start() {
    if (timer || !baseUrl) return;
    refreshPolicy();
    timer = setInterval(refreshPolicy, policyRefreshMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { start, stop, maybeStart, enabled, refreshPolicy, runVisit, policies };
}

module.exports = { createVoiceGuard, detectUtterance, encodeOpus, listenFromCamera };
