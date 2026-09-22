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

  const source = new URL(request.url).searchParams.get("source") === "gpu" ? "gpu" : "local";
  const table = source === "gpu" ? "gpu_people" : "people";
  const db = getDb(env);
  const existing = await db.execute({
    sql: `SELECT id FROM ${table} WHERE id = ? AND account_id = ?`,
    args: [params.id, data.accountId],
  });
  if (!existing.rows[0]) return errorJson("Person not found", 404);

  const label = (body.label || "").trim() || null;
  await db.execute({
    sql: `UPDATE ${table} SET label = ? WHERE id = ? AND account_id = ?`,
    args: [label, params.id, data.accountId],
  });

  return json({ ok: true, label });
});
