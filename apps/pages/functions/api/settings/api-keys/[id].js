import { getDb } from "../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../_lib/http.js";

export const onRequestDelete = withErrorHandling(async ({ params, env, data }) => {
  const result = await getDb(env).execute({
    sql: `UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP
          WHERE id = ? AND account_id = ? AND label NOT LIKE 'web %' AND revoked_at IS NULL
          RETURNING id`,
    args: [params.id, data.accountId],
  });
  if (!result.rows.length) return errorJson("API key not found", 404);
  return json({ ok: true });
});
