import { login } from "../../_lib/auth.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) return errorJson("Email và mật khẩu là bắt buộc", 400);
  const result = await login(env, body);
  return result ? json(result) : errorJson("Email hoặc mật khẩu không đúng", 401);
});
