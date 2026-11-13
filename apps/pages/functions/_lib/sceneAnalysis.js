// High-security cameras: when a person is detected, ask an external vision API
// (the customer's Gemini/OpenAI key, else the platform key) to describe the
// scene like a security guard would. One call per visit, never per frame:
// per-camera cooldown + per-account daily cap, and named (known) people skip it.
import { getDb } from "./db.js";
import { getIntegration, loadAiCredentials } from "./integrations.js";
import { sendTextAlert } from "./telegram.js";

const DEFAULT_COOLDOWN_SECONDS = 180;
const DEFAULT_DAILY_CAP = 300;
const REQUEST_TIMEOUT_MS = 20_000;

export const SCENE_PROMPT = `Bạn là nhân viên bảo vệ nhìn ảnh từ camera cổng/cửa. Chỉ trả về MỘT đối tượng JSON, không thêm chữ nào khác:
{"threat":0-3,"role":"resident|delivery|guest|unknown|suspicious","people":số người,"carrying":"họ đang cầm/mang gì","behavior":"họ đang làm gì","summary":"1 câu tiếng Việt mô tả cảnh","opening":"câu ngắn, lịch sự một bảo vệ sẽ nói với người này"}
Mức threat: 0 = người đi ngang/bình thường; 1 = khách lạ đến cửa; 2 = lảng vảng, che mặt, nhìn vào nhà, thử tay nắm/cổng; 3 = trèo rào, cạy phá, vũ khí hoặc hành vi đe dọa. Không đoán danh tính. Nếu không chắc, chọn mức thấp hơn và nói rõ trong summary.`;

const clamp = (value, low, high) => Math.min(high, Math.max(low, Number.isFinite(Number(value)) ? Math.round(Number(value)) : low));

export function parseScene(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw;
  try { raw = JSON.parse(match[0]); } catch { return null; }
  const roles = ["resident", "delivery", "guest", "unknown", "suspicious"];
  const clean = (value, max) => String(value ?? "").trim().slice(0, max);
  return {
    threat: clamp(raw.threat, 0, 3),
    role: roles.includes(raw.role) ? raw.role : "unknown",
    people: clamp(raw.people, 0, 20),
    carrying: clean(raw.carrying, 120),
    behavior: clean(raw.behavior, 160),
    summary: clean(raw.summary, 300),
    opening: clean(raw.opening, 200),
  };
}

async function callGemini(config, jpeg, signal) {
  const model = config.model || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" }, signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: SCENE_PROMPT }, { inline_data: { mime_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } }] }],
      generationConfig: { maxOutputTokens: 400, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const payload = await response.json();
  return { text: payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "", model };
}

async function callOpenAI(config, jpeg, signal) {
  const model = config.model || "gpt-5-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, signal,
    body: JSON.stringify({
      model, store: false, max_output_tokens: 600,
      input: [{ role: "user", content: [
        { type: "input_text", text: SCENE_PROMPT },
        { type: "input_image", image_url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` },
      ] }],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
  const payload = await response.json();
  const text = payload.output_text || (payload.output || []).flatMap((item) => item.content || []).map((part) => part.text || "").join("");
  return { text, model };
}

// Tries the account's configured providers (Gemini first: cheapest) and
// returns the parsed scene, or null when none is configured / all fail.
export async function analyzeScene(env, accountId, jpeg) {
  const credentials = await loadAiCredentials(env, accountId);
  const attempts = [["gemini", callGemini], ["openai", callOpenAI]].filter(([name]) => credentials[name]?.apiKey);
  for (const [name, call] of attempts) {
    try {
      const { text, model } = await call(credentials[name], jpeg, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      const scene = parseScene(text);
      if (scene) return { ...scene, provider: name, model };
    } catch (error) { console.error(`[scene] ${name} lỗi:`, error.message || error); }
  }
  return null;
}

// Cheap DB-backed gates so cost scales with visits, not frames.
export async function sceneAllowance(env, camera, { personLabel } = {}) {
  if (camera.security_level !== "high") return { allowed: false, reason: "not-high-security" };
  if (personLabel) return { allowed: false, reason: "known-person" };
  const cooldown = Number(env.SCENE_ANALYSIS_COOLDOWN_SECONDS) || DEFAULT_COOLDOWN_SECONDS;
  const cap = Number(env.SCENE_ANALYSIS_DAILY_CAP) || DEFAULT_DAILY_CAP;
  const db = getDb(env, "_lib.sceneAnalysis");
  const [recent, today] = await Promise.all([
    db.execute({
      sql: `SELECT 1 FROM events WHERE account_id = ? AND site_id = ? AND camera = ? AND scene_json IS NOT NULL
            AND timestamp > CURRENT_TIMESTAMP - (? * INTERVAL '1 second') LIMIT 1`,
      args: [camera.account_id, camera.site_id, camera.stream, cooldown],
    }),
    db.execute({
      sql: "SELECT COUNT(*) AS n FROM events WHERE account_id = ? AND scene_json IS NOT NULL AND timestamp > CURRENT_TIMESTAMP - INTERVAL '1 day'",
      args: [camera.account_id],
    }),
  ]);
  if (recent.rows.length) return { allowed: false, reason: "cooldown" };
  if (Number(today.rows[0]?.n) >= cap) return { allowed: false, reason: "daily-cap" };
  return { allowed: true };
}

export async function runSceneCheck(env, { camera, siteName, eventId, frame, personLabel }) {
  const gate = await sceneAllowance(env, camera, { personLabel });
  if (!gate.allowed) return { skipped: gate.reason };
  // Claim the cooldown slot before the (slow) API call so concurrent person
  // events from the same camera don't each trigger their own analysis.
  const db = getDb(env, "_lib.sceneAnalysis");
  await db.execute({ sql: "UPDATE events SET scene_json = '{\"pending\":true}' WHERE id = ?", args: [eventId] });
  const scene = await analyzeScene(env, camera.account_id, frame);
  if (!scene) {
    await db.execute({ sql: "UPDATE events SET scene_json = NULL WHERE id = ?", args: [eventId] });
    return { skipped: "no-provider-or-failed" };
  }
  await db.execute({ sql: "UPDATE events SET scene_json = ?, threat_level = ? WHERE id = ?", args: [JSON.stringify(scene), scene.threat, eventId] });
  if (scene.threat >= 2) {
    const telegram = await getIntegration(env, camera.account_id, "telegram").catch(() => null);
    const label = camera.name || camera.stream;
    const message = `🚨 Bảo vệ AI (${siteName || camera.site_id} · ${label}) mức ${scene.threat}/3: ${scene.summary}${scene.behavior ? ` — ${scene.behavior}` : ""}`;
    if (telegram) await sendTextAlert(telegram, message).catch((error) => console.error("[scene] telegram", error.message || error));
  }
  return { scene };
}
