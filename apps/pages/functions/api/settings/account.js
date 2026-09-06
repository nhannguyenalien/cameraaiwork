import { accountUsage } from "../../_lib/plans.js";
import { getDb } from "../../_lib/db.js";
import { setLegacyAccountEmail, updateAccountPassword } from "../../_lib/auth.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const [summary, accountResult] = await Promise.all([
    accountUsage(env, data.accountId),
    getDb(env).execute({ sql: "SELECT email FROM accounts WHERE id = ?", args: [data.accountId] }),
  ]);
  return json({ ...summary, email: accountResult.rows[0]?.email || "" });
});

export const onRequestPut = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Dữ liệu không hợp lệ", 400);
  try {
    if (body.email) await setLegacyAccountEmail(env, data.accountId, body.email);
    await updateAccountPassword(env, data.accountId, body.newPassword);
    return json({ ok: true });
  } catch (error) {
    if (error.message === "PASSWORD_WEAK") return errorJson("Mật khẩu cần từ 10 đến 1024 ký tự", 400);
    if (error.message === "EMAIL_INVALID") return errorJson("Email không hợp lệ", 400);
    if (error.message === "EMAIL_EXISTS") return errorJson("Email này đã được sử dụng", 409);
    throw error;
  }
});
