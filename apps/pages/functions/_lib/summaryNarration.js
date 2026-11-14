// Voice-over for the daily summary: facts from the day's chosen events ->
// ONE short text call (customer's Gemini/OpenAI key) -> ONE text-to-speech call.
// Every step degrades: no key / API error -> template text, or no audio at all.
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAiCredentials } from "./integrations.js";

const TIMEOUT_MS = 30_000;
const MAX_WORDS = 130; // ~50s of speech

function hhmm(timestamp, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function sceneOf(event) {
  try { const scene = JSON.parse(event.scene_json || "null"); return scene && !scene.pending ? scene : null; } catch { return null; }
}

// One factual line per chosen clip. Never invents identities: only the stored
// scene summary or the "known/unknown person" flag.
export function narrationFacts(clips, tz) {
  return clips.map((event) => {
    const scene = sceneOf(event);
    const what = scene?.summary || (Number(event.people_count) > 0 ? (event.person_id ? "có người quen đi qua" : "có người lạ xuất hiện") : "có chuyển động");
    return { time: hhmm(event.timestamp, tz), camera: event.camera_name || event.camera || "camera", text: what, threat: Number(event.threat_level) || 0 };
  });
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

// Offline fallback so the feature still speaks without any AI key.
export function templateNarration(day, totalEvents, facts, hourly) {
  const top = [...facts].sort((a, b) => b.threat - a.threat).slice(0, 4).sort((a, b) => a.time.localeCompare(b.time));
  const lines = top.map((f) => `Lúc ${f.time}, camera ${f.camera}: ${f.text}.`);
  const peak = peakWindow(hourly);
  const rhythm = peak ? ` Cao điểm từ ${peak.from} đến ${peak.to} giờ với ${peak.count} sự kiện.` : "";
  return `Tóm tắt ngày ${day}. Hệ thống ghi nhận ${totalEvents} sự kiện.${rhythm} ${lines.join(" ")}`.trim();
}

const clip = (text) => String(text || "").replace(/\s+/g, " ").trim().split(" ").slice(0, MAX_WORDS).join(" ");

export async function writeNarration(env, accountId, { day, totalEvents, facts, hourly, tz }, deps = {}) {
  const fallback = templateNarration(day, totalEvents, facts, hourly);
  const peak = peakWindow(hourly);
  const credentials = await (deps.credentials ? deps.credentials() : loadAiCredentials(env, accountId)).catch(() => ({}));
  const prompt = `Bạn là nhân viên bảo vệ đọc báo cáo cuối ngày cho chủ nhà. Viết lời đọc tiếng Việt, tối đa ${MAX_WORDS} từ, giọng tự nhiên, không icon, không markdown. Chỉ dùng dữ kiện dưới đây, không bịa danh tính hay chi tiết. Nêu số sự kiện, nhịp độ trong ngày, các việc đáng chú ý theo giờ, kết bằng 1 câu đánh giá chung. Video chỉ là các cảnh tiêu biểu, không phải toàn bộ sự kiện.\nNgày ${day}, tổng ${totalEvents} sự kiện.${peak ? ` Cao điểm từ ${peak.from} đến ${peak.to} giờ (${peak.count} sự kiện).` : ""}\nCác cảnh tiêu biểu:\n` +
    facts.map((f) => `- ${f.time} camera ${f.camera}${f.threat >= 2 ? " [đáng ngờ]" : ""}: ${f.text}`).join("\n");
  const attempts = [];
  if (credentials.gemini?.apiKey) attempts.push(async () => {
    const model = credentials.gemini.model || "gemini-2.5-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": credentials.gemini.apiKey, "Content-Type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    return (await r.json()).candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  });
  if (credentials.openai?.apiKey) attempts.push(async () => {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${credentials.openai.apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ model: credentials.openai.model || "gpt-5-mini", store: false, max_output_tokens: 600, input: prompt }),
    });
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
    const p = await r.json();
    return p.output_text || (p.output || []).flatMap((i) => i.content || []).map((c) => c.text || "").join("");
  });
  for (const attempt of attempts) {
    try { const text = clip(await attempt()); if (text.length > 20) return { text, source: "ai" }; }
    catch (error) { console.error("[summary-narration] text:", error.message || error); }
  }
  return { text: clip(fallback), source: "template" };
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
