import { login } from "../../_lib/auth.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { checkAuthRateLimit, clearAuthRateLimit } from "../../_lib/rateLimit.js";
import { isWebClient, sessionCookie } from "../../_lib/session.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) return errorJson("Email và mật khẩu là bắt buộc", 400);
  const rate = await checkAuthRateLimit(env, request, "login", body.email, 10, 15);
  if (!rate.allowed) return errorJson("Thử đăng nhập quá nhiều. Vui lòng đợi 15 phút.", 429);
  const result = await login(env, body);
  if (!result) return errorJson("Email hoặc mật khẩu không đúng", 401);
  await clearAuthRateLimit(env, rate.key);
  if (isWebClient(request)) {
    return json({ accountId: result.accountId }, { headers: { "Set-Cookie": sessionCookie(result.apiKey) } });
  }
  return json(result);
});
