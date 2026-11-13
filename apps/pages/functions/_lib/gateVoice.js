// "Quản gia cổng": when a camera is set to high security the on-site relay
// talks to visitors through the camera speaker. Each camera is its own
// SchoolsAI tenant (own persona/knowledge); this module holds the per-camera
// key, proxies one spoken turn at a time, and keeps a short visit log that is
// summarised for the owner. The butler can only talk and report — it has no
// tools to open gates or change anything.
import { getDb } from "./db.js";
import { decryptConfig, encryptConfig, getIntegration } from "./integrations.js";
import { getSiteUnscoped } from "./sites.js";
import { saveAgentMessage } from "./agentMessages.js";
import { sendTextAlert } from "./telegram.js";
import { errorJson } from "./http.js";

export const MAX_TURNS = 4;
export const MAX_AUDIO_BYTES = 1.5 * 1024 ** 2;
const SESSION_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_BASE = "https://apic.schoolsai.work";

export function voiceBase(env) {
  return String(env.SCHOOLSAI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

export async function authenticateRelay(request, env) {
  const siteId = new URL(request.url).searchParams.get("siteId");
  if (!siteId) return null;
  const site = await getSiteUnscoped(env, siteId);
  return site?.relay_secret && request.headers.get("x-relay-secret") === site.relay_secret ? site : null;
}

export async function loadVoiceCamera(env, site, stream) {
  const result = await getDb(env, "_lib.gateVoice").execute({
    sql: "SELECT * FROM cameras WHERE site_id = ? AND stream = ? AND account_id = ?",
    args: [site.id, stream, site.account_id],
  });
  const camera = result.rows[0];
  if (!camera) return { error: errorJson("Camera not found", 404) };
  if (camera.security_level !== "high") return { error: errorJson("Camera chưa bật high security", 403) };
  if (!camera.voice_key_enc) return { error: errorJson("Camera chưa có khóa quản gia", 409) };
  let apiKey;
  try { apiKey = (await decryptConfig(env, camera.voice_key_enc)).apiKey; } catch { /* fall through */ }
  if (!apiKey) return { error: errorJson("Không đọc được khóa quản gia", 500) };
  return { camera, apiKey };
}

export const sealVoiceKey = (env, apiKey) => encryptConfig(env, { apiKey });

async function voiceFetch(env, apiKey, path, init) {
  const response = await fetch(`${voiceBase(env)}/api/v1/ai-voice/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(45000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw Object.assign(new Error(body.error || `SchoolsAI voice HTTP ${response.status}`), { status: 502 });
  }
  return body;
}

export const voiceGreeting = (env, apiKey, lang = "vi") =>
  voiceFetch(env, apiKey, "greeting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang }) });

export function voiceTurn(env, apiKey, audio, contentType, session, durationMs, context) {
  const form = new FormData();
  if (context) form.append("context", context);
  form.append("audio", new Blob([audio], { type: contentType }), "turn.webm");
  form.append("session", session);
  form.append("username", "Khách");
  if (durationMs) form.append("duration_ms", String(durationMs));
  return voiceFetch(env, apiKey, "turn", { method: "POST", body: form });
}

const SCENE_WINDOW_SECONDS = 120;

// The vision analysis runs when the person is first detected (see
// sceneAnalysis.js), seconds before the visitor speaks, so the butler finds it
// by camera instead of needing a visit<->event link.
export async function recentScene(env, camera) {
  const result = await getDb(env, "_lib.gateVoice").execute({
    sql: `SELECT scene_json FROM events WHERE account_id = ? AND site_id = ? AND camera = ? AND scene_json IS NOT NULL
          AND timestamp > CURRENT_TIMESTAMP - (? * INTERVAL '1 second') ORDER BY timestamp DESC, id DESC LIMIT 1`,
    args: [camera.account_id, camera.site_id, camera.stream, SCENE_WINDOW_SECONDS],
  });
  try {
    const scene = JSON.parse(result.rows[0]?.scene_json || "null");
    return scene && !scene.pending && typeof scene.summary === "string" ? scene : null;
  } catch { return null; }
}

// Text handed to the voice AI so it asks relevant questions. The butler is told
// not to read the analysis out; it can only talk, never act.
export function sceneContext(scene) {
  if (!scene) return "";
  const parts = [`Cảnh camera: ${scene.summary}`];
  if (scene.carrying) parts.push(`Đang mang: ${scene.carrying}`);
  if (scene.behavior) parts.push(`Hành vi: ${scene.behavior}`);
  parts.push(`Đánh giá: ${scene.role}, nguy cơ ${scene.threat}/3`);
  if (scene.opening) parts.push(`Gợi ý cách nói: ${scene.opening}`);
  return `[Ngữ cảnh nội bộ từ camera, KHÔNG đọc nguyên văn cho khách; hãy hỏi mục đích một cách lịch sự] ${parts.join(". ")}`.slice(0, 900);
}

const parse = (text) => { try { const value = JSON.parse(text); return Array.isArray(value) ? value : []; } catch { return []; } };

export async function openVisit(env, camera, visitId) {
  const db = getDb(env, "_lib.gateVoice");
  const existing = await db.execute({ sql: "SELECT * FROM gate_visits WHERE id = ? AND camera_id = ?", args: [visitId, camera.id] });
  if (existing.rows[0]) return existing.rows[0];
  await db.execute({
    sql: "INSERT INTO gate_visits (id, account_id, site_id, camera_id) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
    args: [visitId, camera.account_id, camera.site_id, camera.id],
  });
  return (await db.execute({ sql: "SELECT * FROM gate_visits WHERE id = ?", args: [visitId] })).rows[0];
}

export function visitUsable(visit) {
  return visit && visit.status === "open" && Number(visit.turns) < MAX_TURNS
    && Date.now() - new Date(visit.started_at).getTime() < SESSION_MAX_AGE_MS;
}

export async function recordTurn(env, visit, { transcript, reply, needsHuman, scene }) {
  const lines = parse(visit.transcript);
  if (scene?.summary && !lines.some((line) => line.who === "scene")) lines.push({ who: "scene", text: scene.summary });
  if (transcript) lines.push({ who: "visitor", text: transcript });
  if (reply) lines.push({ who: "butler", text: reply });
  await getDb(env, "_lib.gateVoice").execute({
    sql: "UPDATE gate_visits SET transcript = ?, turns = turns + 1, needs_human = (needs_human OR ?) WHERE id = ?",
    args: [JSON.stringify(lines.slice(-24)), Boolean(needsHuman), visit.id],
  });
  return lines;
}

export function summarize(lines, needsHuman) {
  const visitor = lines.filter((line) => line.who === "visitor").map((line) => line.text).filter(Boolean);
  const sceneText = lines.find((line) => line.who === "scene")?.text;
  const seen = sceneText ? ` Camera thấy: ${sceneText}` : "";
  if (!visitor.length) return `Có người ở cổng nhưng chưa nói gì rõ ràng.${seen}`;
  const said = visitor.join(" / ").slice(0, 400);
  return `${needsHuman ? "⚠️ Cần chủ nhà. " : ""}Khách nói: ${said}${seen}`;
}

// Closes the visit once and tells the owner (agent chat + Telegram if linked).
export async function finishVisit(env, visitId, camera) {
  const db = getDb(env, "_lib.gateVoice");
  const result = await db.execute({ sql: "SELECT * FROM gate_visits WHERE id = ? AND camera_id = ?", args: [visitId, camera.id] });
  const visit = result.rows[0];
  if (!visit) return null;
  if (visit.status === "closed") return { summary: visit.summary, needsHuman: Boolean(visit.needs_human) };
  const lines = parse(visit.transcript);
  const needsHuman = Boolean(visit.needs_human);
  const summary = summarize(lines, needsHuman);
  const claimed = await db.execute({
    sql: "UPDATE gate_visits SET status = 'closed', ended_at = CURRENT_TIMESTAMP, summary = ? WHERE id = ? AND status = 'open' RETURNING id",
    args: [summary, visit.id],
  });
  if (!claimed.rows.length) return { summary, needsHuman };
  const label = camera.name || camera.stream;
  const message = `🛎️ Quản gia cổng (${label}): ${summary}`;
  await saveAgentMessage(env, camera.account_id, "assistant", message, "patrol").catch((error) => console.error("gate summary chat", error));
  const telegram = await getIntegration(env, camera.account_id, "telegram").catch(() => null);
  if (telegram) await sendTextAlert(telegram, message).catch((error) => console.error("gate summary telegram", error));
  return { summary, needsHuman };
}
