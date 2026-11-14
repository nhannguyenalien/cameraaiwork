// Voice-over for the daily summary: facts from the day's chosen events ->
// ONE short text call (customer's Gemini/OpenAI key) -> ONE text-to-speech call.
// Every step degrades: no key / API error -> template text, or no audio at all.
import { loadAiCredentials } from "./integrations.js";

const TIMEOUT_MS = 30_000;
const MAX_WORDS = 90; // ~35-40s of speech

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
    return { time: hhmm(event.timestamp, tz), camera: event.camera || "camera", text: what, threat: Number(event.threat_level) || 0 };
  });
}

// Offline fallback so the feature still speaks without any AI key.
export function templateNarration(day, totalEvents, facts) {
  const top = [...facts].sort((a, b) => b.threat - a.threat).slice(0, 4).sort((a, b) => a.time.localeCompare(b.time));
  const lines = top.map((f) => `Lúc ${f.time}, camera ${f.camera}: ${f.text}.`);
  return `Tóm tắt ngày ${day}. Hệ thống ghi nhận ${totalEvents} sự kiện. ${lines.join(" ")}`.trim();
}

const clip = (text) => String(text || "").replace(/\s+/g, " ").trim().split(" ").slice(0, MAX_WORDS).join(" ");

export async function writeNarration(env, accountId, { day, totalEvents, facts, tz }, deps = {}) {
  const fallback = templateNarration(day, totalEvents, facts);
  const credentials = await (deps.credentials ? deps.credentials() : loadAiCredentials(env, accountId)).catch(() => ({}));
  const prompt = `Bạn là nhân viên bảo vệ đọc báo cáo cuối ngày cho chủ nhà. Viết lời đọc tiếng Việt, tối đa ${MAX_WORDS} từ, giọng tự nhiên, không icon, không markdown. Chỉ dùng dữ kiện dưới đây, không bịa danh tính hay chi tiết. Nêu số sự kiện, các việc đáng chú ý theo giờ, kết bằng 1 câu đánh giá chung.\nNgày ${day}, tổng ${totalEvents} sự kiện.\n` +
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

// Returns { bytes, format: "pcm" | "wav" } or null. pcm = signed 16-bit LE, 24 kHz, mono.
export async function synthesizeSpeech(env, accountId, text, deps = {}) {
  const credentials = await (deps.credentials ? deps.credentials() : loadAiCredentials(env, accountId)).catch(() => ({}));
  if (credentials.gemini?.apiKey) {
    try {
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
      if (data) return { bytes: Buffer.from(data, "base64"), format: "pcm" };
    } catch (error) { console.error("[summary-narration] gemini tts:", error.message || error); }
  }
  if (credentials.openai?.apiKey) {
    try {
      const r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST", headers: { Authorization: `Bearer ${credentials.openai.apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ model: env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "wav" }),
      });
      if (!r.ok) throw new Error(`OpenAI TTS HTTP ${r.status}`);
      return { bytes: Buffer.from(await r.arrayBuffer()), format: "wav" };
    } catch (error) { console.error("[summary-narration] openai tts:", error.message || error); }
  }
  return null;
}
