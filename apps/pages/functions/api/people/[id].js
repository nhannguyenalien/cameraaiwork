// PATCH /api/people/:id  { "label": "Bố" }
// Names a clustered person. Pass "" or null to clear the label back to
// unnamed.
import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPatch = withErrorHandling(async ({ request, params, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const db = getDb(env);
  const existing = await db.execute({
    sql: "SELECT id FROM people WHERE id = ? AND account_id = ?",
    args: [params.id, data.accountId],
  });
  if (!existing.rows[0]) return errorJson("Person not found", 404);

  const label = (body.label || "").trim() || null;
  await db.execute({
    sql: "UPDATE people SET label = ? WHERE id = ?",
    args: [label, params.id],
  });

  return json({ ok: true, label });
});
