import { getDb } from "../../_lib/db.js";
import { sha256Hex } from "../../_lib/ids.js";
import { json, withErrorHandling } from "../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer) {
    await getDb(env).execute({
      sql: "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND account_id = ?",
      args: [await sha256Hex(bearer), data.accountId],
    });
  }
  return json({ ok: true });
});
