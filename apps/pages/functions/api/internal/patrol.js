// Scheduled "patrol" digest: called on a cron by GitHub Actions (same
// pattern as /api/internal/maintenance), not by a customer. For every
// account with at least one site, summarizes recent camera events with the
// same AI agent used for on-demand questions (_lib/cameraAgent.js) and
// drops one consolidated report straight into that account's AI agent chat
// (agent_messages, source='patrol' — see _lib/agentMessages.js) so it shows
// up next to the homeowner's own questions instead of a separate Telegram
// channel. This is the proactive counterpart to the real-time
// per-detection alert /api/motion already sends. Two modes, chosen by the
// caller's cron schedule:
//   "activity" (default) — only writes a message when something happened in the window.
//   "daily"    — always writes one, so the homeowner gets a "all quiet" check-in too.
import { getDb } from "../../_lib/db.js";
import { loadAiCredentials } from "../../_lib/integrations.js";
import { askGemini, askOpenAI, makeAgentContext } from "../../_lib/cameraAgent.js";
import { saveAgentMessage } from "../../_lib/agentMessages.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

const MAX_EVENTS = 500;
const DEFAULT_TIMEZONE_OFFSET_MINUTES = 420; // Asia/Ho_Chi_Minh; matches cameraAgent.js's default.

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function windowLabel(minutes) {
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes} phút`;
}

async function accountIdsWithSites(db) {
  const result = await db.execute({ sql: "SELECT DISTINCT account_id FROM sites", args: [] });
  return result.rows.map((row) => row.account_id);
}

async function loadCamerasAndEvents(db, accountId, range) {
  const [cameraResult, eventResult] = await Promise.all([
    db.execute({
      sql: `SELECT c.id AS camera_id, c.stream, c.name AS camera_name, c.record_on_person,
                   s.id AS site_id, s.name AS site_name,
                   CASE WHEN s.ai_worker_url IS NOT NULL THEN 1 ELSE 0 END AS ai_worker_configured
            FROM cameras c JOIN sites s ON s.id = c.site_id
            WHERE c.account_id = ? ORDER BY s.name, c.name`,
      args: [accountId],
    }),
    db.execute({
      sql: `SELECT e.id, e.site_id, e.camera, e.timestamp, e.type, e.person_id,
                   primary_person.label AS person_label, e.image_key, e.video_status,
                   s.name AS site_name, c.name AS camera_name,
                   COALESCE(json_agg(json_build_object('id', p.id, 'label', p.label))
                     FILTER (WHERE p.id IS NOT NULL), '[]') AS people
            FROM events e
            LEFT JOIN sites s ON s.id = e.site_id
            LEFT JOIN cameras c ON c.site_id = e.site_id AND c.stream = e.camera
            LEFT JOIN people primary_person ON primary_person.id = e.person_id AND primary_person.account_id = e.account_id
            LEFT JOIN event_people ep ON ep.event_id = e.id
            LEFT JOIN people p ON p.id = ep.person_id AND p.account_id = e.account_id
            WHERE e.account_id = ? AND e.timestamp >= ? AND e.timestamp < ?
            GROUP BY e.id, s.name, c.name, primary_person.label
            ORDER BY e.timestamp ASC LIMIT ?`,
      args: [accountId, range.start.toISOString(), range.end.toISOString(), MAX_EVENTS],
    }),
  ]);
  return { cameras: cameraResult.rows, events: eventResult.rows };
}

async function buildDigestText(env, accountId, range, cameras, events) {
  const question = `Tóm tắt hoạt động camera từ ${range.start.toISOString()} đến ${range.end.toISOString()} cho chủ nhà đang bận việc khác. Nêu bật người chưa đặt tên (label) và bất kỳ điều gì bất thường; nếu mọi thứ bình thường thì nói ngắn gọn là không có gì đáng chú ý.`;
  const { prompt } = makeAgentContext(question, range, cameras, events);
  const credentials = await loadAiCredentials(env, accountId);
  const failures = [];
  for (const provider of ["openai", "gemini"]) {
    if (!credentials[provider]) continue;
    try {
      const result = provider === "openai" ? await askOpenAI(credentials.openai, prompt) : await askGemini(credentials.gemini, prompt);
      return result.answer;
    } catch (error) {
      failures.push(`${provider}: ${error.message || error}`);
    }
  }
  if (failures.length) console.error(`Patrol digest AI thất bại (${accountId}):`, failures.join("; "));
  return null;
}

async function patrolAccount(env, db, accountId, mode, range, minutes) {
  const { cameras, events } = await loadCamerasAndEvents(db, accountId, range);
  if (!events.length) {
    if (mode !== "daily") return { accountId, eventCount: 0, sent: false };
    await saveAgentMessage(env, accountId, "assistant", `🏠 Báo cáo camera (${windowLabel(minutes)} qua): không có sự kiện nào được ghi nhận.`, "patrol");
    return { accountId, eventCount: 0, sent: true };
  }

  // Events exist but no AI provider is configured/working — a raw count is
  // still more useful to the homeowner than silence.
  const answer = await buildDigestText(env, accountId, range, cameras, events);
  const header = `🏠 Báo cáo camera (${events.length} sự kiện, ${windowLabel(minutes)} qua)\n\n`;
  const body = answer || events.map((event) => `#${event.id} ${event.camera_name || event.camera} — ${event.person_label || "chưa đặt tên"}`).join("\n");
  await saveAgentMessage(env, accountId, "assistant", header + body, "patrol");
  return { accountId, eventCount: events.length, sent: true, aiSummarized: Boolean(answer) };
}

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.MAINTENANCE_SECRET || bearer !== env.MAINTENANCE_SECRET) return errorJson("Unauthorized", 401);

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "daily" ? "daily" : "activity";
  const defaultMinutes = mode === "daily"
    ? positiveInt(env.PATROL_DAILY_WINDOW_MINUTES, 24 * 60)
    : positiveInt(env.PATROL_WINDOW_MINUTES, 65);
  const minutes = positiveInt(body.windowMinutes, defaultMinutes);

  const end = new Date();
  const range = { start: new Date(end.getTime() - minutes * 60_000), end, timezoneOffsetMinutes: DEFAULT_TIMEZONE_OFFSET_MINUTES };

  const db = getDb(env);
  const ids = await accountIdsWithSites(db);
  const results = [];
  for (const accountId of ids) {
    try {
      results.push(await patrolAccount(env, db, accountId, mode, range, minutes));
    } catch (error) {
      console.error(`Patrol lỗi (${accountId}):`, error.message || error);
      results.push({ accountId, error: error.message || String(error) });
    }
  }

  return json({ ok: true, mode, windowMinutes: minutes, checkedAt: end.toISOString(), accounts: results });
});
