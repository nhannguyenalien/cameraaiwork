import { chatSchoolsSupport } from "../../_lib/schoolsAi.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

const attempts = new Map();

function rateLimited(request) {
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  if (attempts.size > 5_000) attempts.clear();
  const recent = (attempts.get(key) || []).filter((value) => now - value < 60_000);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > 12;
}

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  if (rateLimited(request)) return errorJson("Bạn gửi quá nhanh, vui lòng thử lại sau một phút", 429);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return errorJson("Origin không hợp lệ", 403);
  const body = await request.json().catch(() => null);
  const question = String(body?.question || "").trim();
  const session = String(body?.session || "").trim();
  if (!question || question.length > 2_000) return errorJson("Câu hỏi phải từ 1 đến 2000 ký tự", 400);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(session)) return errorJson("Session không hợp lệ", 400);
  const result = await chatSchoolsSupport(env, { session: `cameraai-support-${session}`, question });
  return json(result, { headers: { "Cache-Control": "no-store" } });
});
