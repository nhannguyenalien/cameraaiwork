import { getDb } from "../../_lib/db.js";
import { sha256Hex } from "../../_lib/ids.js";
import { json, withErrorHandling } from "../../_lib/http.js";
import { clearSessionCookie, readSessionToken } from "../../_lib/session.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const token = readSessionToken(request);
  if (token) {
    await getDb(env).execute({
      sql: "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND account_id = ?",
      args: [await sha256Hex(token), data.accountId],
    });
  }
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
});
