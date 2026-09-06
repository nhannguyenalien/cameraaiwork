import { getDb } from "../_lib/db.js";
import { json, withErrorHandling } from "../_lib/http.js";
import { randomSecret, sha256Hex } from "../_lib/ids.js";

export const onRequestPost = withErrorHandling(async ({ env, data }) => {
  const token = `install-${randomSecret()}`;
  const tokenHash = await sha256Hex(token);
  const db = getDb(env);
  await db.execute({
    sql: "DELETE FROM install_tokens WHERE account_id = ? AND (used_at IS NOT NULL OR expires_at <= datetime('now'))",
    args: [data.accountId],
  });
  await db.execute({
    sql: "INSERT INTO install_tokens (id, account_id, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))",
    args: [tokenHash, data.accountId],
  });
  return json({ token, expiresInSeconds: 900 });
});
