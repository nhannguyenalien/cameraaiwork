import { createAccount } from "../../_lib/auth.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { checkAuthRateLimit } from "../../_lib/rateLimit.js";
import { isWebClient, sessionCookie } from "../../_lib/session.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body", 400);
  const rate = await checkAuthRateLimit(env, request, "signup", body.email, 5, 60);
  if (!rate.allowed) return errorJson("Tạo tài khoản quá nhiều. Vui lòng thử lại sau.", 429);
  try {
    const result = await createAccount(env, body);
    if (isWebClient(request)) {
      return json({ accountId: result.accountId }, { status: 201, headers: { "Set-Cookie": sessionCookie(result.apiKey) } });
    }
    return json(result, { status: 201 });
  } catch (error) {
    const messages = { EMAIL_INVALID: "Email không hợp lệ", PASSWORD_WEAK: "Mật khẩu cần ít nhất 10 ký tự", EMAIL_EXISTS: "Email đã tồn tại" };
    if (messages[error.message]) return errorJson(messages[error.message], 400);
    throw error;
  }
});
