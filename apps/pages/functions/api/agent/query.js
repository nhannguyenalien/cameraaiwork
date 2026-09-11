import { getDb } from "../../_lib/db.js";
import { loadAiCredentials } from "../../_lib/integrations.js";
import { actionCatalog } from "../../_lib/agentActions.js";
import { askGemini, askOpenAI, makeAgentContext, resolveTimeRange } from "../../_lib/cameraAgent.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

const MAX_EVENTS = 500;

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  const question = body?.question?.trim();
  if (!question) return errorJson("question là bắt buộc", 400);
  if (question.length > 1000) return errorJson("question tối đa 1000 ký tự", 400);
  if (body.provider && !["auto", "openai", "gemini"].includes(body.provider)) return errorJson("provider không hợp lệ", 400);

  const range = resolveTimeRange(question, { timezoneOffsetMinutes: body.timezoneOffsetMinutes });
  const db = getDb(env);
  const [cameraResult, eventResult] = await Promise.all([
    db.execute({
      sql: `SELECT c.id AS camera_id, c.stream, c.name AS camera_name, c.record_on_person,
                   s.id AS site_id, s.name AS site_name,
                   CASE WHEN s.ai_worker_url IS NOT NULL THEN 1 ELSE 0 END AS ai_worker_configured
            FROM cameras c JOIN sites s ON s.id = c.site_id
            WHERE c.account_id = ? ORDER BY s.name, c.name`,
      args: [data.accountId],
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
      args: [data.accountId, range.start.toISOString(), range.end.toISOString(), MAX_EVENTS],
    }),
  ]);

  const { visits, prompt } = makeAgentContext(question, range, cameraResult.rows, eventResult.rows);
  const credentials = await loadAiCredentials(env, data.accountId);
  const order = body.provider === "openai" ? ["openai"] : body.provider === "gemini" ? ["gemini"] : ["openai", "gemini"];
  const failures = [];
  for (const provider of order) {
    if (!credentials[provider]) continue;
    try {
      const result = provider === "openai" ? await askOpenAI(credentials.openai, prompt) : await askGemini(credentials.gemini, prompt);
      return json({ ...result, provider, range, visits, eventCount: eventResult.rows.length, truncated: eventResult.rows.length === MAX_EVENTS, actions: actionCatalog() });
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (!order.some((provider) => credentials[provider])) {
    return errorJson("Chưa cấu hình OpenAI API key hoặc Gemini API key", 409);
  }
  return errorJson(`Không gọi được AI provider: ${failures.join("; ")}`, 502);
});
