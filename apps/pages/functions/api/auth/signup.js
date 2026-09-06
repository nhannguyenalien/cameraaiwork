import { createAccount } from "../../_lib/auth.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body", 400);
  try {
    return json(await createAccount(env, body), { status: 201 });
  } catch (error) {
    const messages = { EMAIL_INVALID: "Email không hợp lệ", PASSWORD_WEAK: "Mật khẩu cần ít nhất 10 ký tự", EMAIL_EXISTS: "Email đã tồn tại" };
    if (messages[error.message]) return errorJson(messages[error.message], 400);
    throw error;
  }
});
