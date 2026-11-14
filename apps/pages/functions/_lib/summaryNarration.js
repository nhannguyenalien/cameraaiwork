// Voice-over for the daily summary: facts from the day's chosen events ->
// ONE short text call (customer's Gemini/OpenAI key) -> ONE text-to-speech call.
// Every step degrades: no key / API error -> template text, or no audio at all.
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAiCredentials } from "./integrations.js";


function hhmm(timestamp, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function sceneOf(event) {
  try { const scene = JSON.parse(event.scene_json || "null"); return scene && !scene.pending ? scene : null; } catch { return null; }
}

// "cao điểm 10–13 giờ (210 sự kiện)": busiest 3-hour window of the whole day.
export function peakWindow(hourly) {
  if (!hourly?.some((n) => n > 0)) return null;
  let best = { start: 0, count: -1 };
  for (let h = 0; h < 22; h += 1) {
    const count = hourly[h] + hourly[h + 1] + hourly[h + 2];
    if (count > best.count) best = { start: h, count };
  }
  return { from: best.start, to: best.start + 3, count: best.count };
}

// General facts only (no AI): totals, busiest window, number of flagged scenes.
export function introText({ day, totalEvents, hourly, cameraName = "", alerts = 0 }) {
  const peak = peakWindow(hourly);
  const parts = [`Tóm tắt ngày ${day}${cameraName ? `, camera ${cameraName}` : ""}.`, `${totalEvents} sự kiện.`];
  if (peak) parts.push(`Cao điểm từ ${peak.from} đến ${peak.to} giờ.`);
  if (alerts) parts.push(`Có ${alerts} cảnh cần chú ý.`);
  return parts.join(" ");
}

// A spoken line ONLY for scenes the high-security analysis already described
// (stored scene_json). Everything else stays silent: no guessing from metadata.
export function sceneCue(event, tz) {
  const scene = sceneOf(event);
  if (!scene?.summary) return null;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.timestamp)).split(":");
  const level = Number(scene.threat) >= 2 ? "Đáng ngờ. " : "";
  return `${time[0]} giờ ${time[1]}. ${level}${String(scene.summary).split(" ").slice(0, 28).join(" ")}`;
}

// Speech providers, tried in order (DAILY_SUMMARY_TTS="edge,gtts,piper,gemini,openai").
// Each returns { bytes, format: "mp3" | "wav" | "pcm" } or throws. pcm = s16le 24 kHz mono.
const DEFAULT_ORDER = "edge,gtts,piper,gemini,openai";

// Split on sentence ends, then words, so every piece stays under `max` chars.
export function splitForTts(text, max = 180) {
  const pieces = [];
  for (const sentence of String(text).replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/)) {
    let current = "";
    for (const word of sentence.split(" ")) {
      if ((current + " " + word).trim().length > max) { if (current) pieces.push(current); current = word; }
      else current = (current + " " + word).trim();
    }
    if (current) pieces.push(current);
  }
  return pieces;
}

const providers = {
  // Microsoft Edge "read aloud" (unofficial, free, no key).
  async edge(env, _accountId, text) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata(env.EDGE_TTS_VOICE || "vi-VN-HoaiMyNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 60_000);
      audioStream.on("data", (d) => chunks.push(d));
      audioStream.on("end", () => { clearTimeout(timer); resolve(); });
      audioStream.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 1000) throw new Error("empty audio");
    return { bytes, format: "mp3" };
  },
  // Google Translate voice (unofficial, free): ~200 chars per request, so chunk.
  async gtts(_env, _accountId, text) {
    const parts = [];
    for (const piece of splitForTts(text)) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(piece)}`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`Google TTS HTTP ${r.status}`);
      parts.push(Buffer.from(await r.arrayBuffer()));
    }
    const bytes = Buffer.concat(parts); // concatenated mp3 frames decode fine in ffmpeg
    if (bytes.length < 1000) throw new Error("empty audio");
    return { bytes, format: "mp3" };
  },
  // Offline neural voice bundled in the Docker image (/opt/piper). Never depends on a third party.
  async piper(env, _accountId, text) {
    const bin = env.PIPER_BIN || "piper";
    const model = env.PIPER_MODEL || "/opt/piper/vi_VN-vais1000-medium.onnx";
    await access(model);
    const dir = await mkdtemp(join(tmpdir(), "piper-"));
    try {
      const out = join(dir, "out.wav");
      await new Promise((resolve, reject) => {
        const child = spawn(bin, ["--model", model, "--output_file", out], { stdio: ["pipe", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-500); });
        const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
        child.on("error", (e) => { clearTimeout(timer); reject(e); });
        child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`piper exit ${code}: ${stderr}`)); });
        child.stdin.end(text.replace(/\s+/g, " "));
      });
      return { bytes: await readFile(out), format: "wav" };
    } finally { await rm(dir, { recursive: true, force: true }); }
  },
  async gemini(env, accountId, text, credentials) {
    if (!credentials.gemini?.apiKey) throw new Error("no gemini key");
    const model = env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": credentials.gemini.apiKey, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_TTS_VOICE || "Kore" } } } },
      }),
    });
    if (!r.ok) throw new Error(`Gemini TTS HTTP ${r.status}`);
    const data = (await r.json()).candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!data) throw new Error("no audio");
    return { bytes: Buffer.from(data, "base64"), format: "pcm" };
  },
  async openai(env, accountId, text, credentials) {
    if (!credentials.openai?.apiKey) throw new Error("no openai key");
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${credentials.openai.apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "wav" }),
    });
    if (!r.ok) throw new Error(`OpenAI TTS HTTP ${r.status}`);
    return { bytes: Buffer.from(await r.arrayBuffer()), format: "wav" };
  },
};

export async function synthesizeSpeech(env, accountId, text, deps = {}) {
  const order = String(env.DAILY_SUMMARY_TTS || process.env.DAILY_SUMMARY_TTS || DEFAULT_ORDER).split(",").map((n) => n.trim()).filter(Boolean);
  let credentials;
  for (const name of order) {
    const run = deps.providers?.[name] || providers[name];
    if (!run) continue;
    try {
      if (!credentials && (name === "gemini" || name === "openai")) credentials = await (deps.credentials ? deps.credentials() : loadAiCredentials(env, accountId)).catch(() => ({}));
      return { ...(await run(env, accountId, text, credentials || {})), provider: name };
    } catch (error) { console.error(`[summary-narration] tts ${name}:`, error.message || error); }
  }
  return null;
}
