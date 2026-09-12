import { getDb } from "../../_lib/db.js";
import { randomSecret, sha256Hex } from "../../_lib/ids.js";
import { validateApiKeyInput } from "../../_lib/apiKeys.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

// Browser session tokens (see _lib/auth.js) live in this same table under a
// 'web %' label. Excluded here so this surface only ever shows/touches keys
// the account holder created for their own external use.
const SESSION_LABEL_PATTERN = "web %";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  // Revoking a key is meant to make it disappear from this list, not just
  // stop working — there's no "revocation history" view, so a revoked key
  // left visible here has no revoke button that would do anything (the
  // DELETE handler only matches revoked_at IS NULL) and just clutters the
  // list looking identical to an active key.
  const result = await getDb(env).execute({
    sql: `SELECT id, label, scope, created_at, expires_at FROM api_keys
          WHERE account_id = ? AND label NOT LIKE ? AND revoked_at IS NULL
          ORDER BY created_at DESC`,
    args: [data.accountId, SESSION_LABEL_PATTERN],
  });
  return json(result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    scope: row.scope,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  })));
});

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  let input;
  try {
    input = validateApiKeyInput(body);
  } catch (error) {
    return errorJson(error.message, 400);
  }

  const apiKey = `key-${randomSecret()}`;
  const id = await sha256Hex(apiKey);
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000).toISOString() : null;
  const db = getDb(env);
  const inserted = await db.execute({
    sql: "INSERT INTO api_keys (id, account_id, label, scope, expires_at) VALUES (?, ?, ?, ?, ?) RETURNING created_at",
    args: [id, data.accountId, input.label, input.scope, expiresAt],
  });

  return json({
    id,
    label: input.label,
    scope: input.scope,
    apiKey,
    createdAt: inserted.rows[0]?.created_at,
    expiresAt,
  }, { status: 201 });
});
