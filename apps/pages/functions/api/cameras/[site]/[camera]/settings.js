import { getCamera } from "../../../../_lib/sites.js";
import { getDb } from "../../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestPatch = withErrorHandling(async ({ request, params, env, data }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.recordOnPerson !== "boolean") {
    return errorJson("recordOnPerson phải là true hoặc false", 400);
  }

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  await getDb(env).execute({
    sql: "UPDATE cameras SET record_on_person = ? WHERE id = ? AND site_id = ? AND account_id = ?",
    args: [body.recordOnPerson ? 1 : 0, camera.id, params.site, data.accountId],
  });
  return json({ ok: true, recordOnPerson: body.recordOnPerson });
});
