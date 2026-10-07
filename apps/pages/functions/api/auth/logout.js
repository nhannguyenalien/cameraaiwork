import { getDb } from "../../_lib/db.js";
import { sha256Hex } from "../../_lib/ids.js";
import { forgetAuth } from "../../_lib/authCache.js";
import { json, withErrorHandling } from "../../_lib/http.js";
import { clearSessionCookie, readSessionToken } from "../../_lib/session.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const token = readSessionToken(request);
  if (token) {
    const keyHash = await sha256Hex(token);
    await getDb(env, "api.auth.logout").execute({
      sql: "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND account_id = ?",
      args: [keyHash, data.accountId],
    });
    await forgetAuth(env, keyHash);
  }
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
});
