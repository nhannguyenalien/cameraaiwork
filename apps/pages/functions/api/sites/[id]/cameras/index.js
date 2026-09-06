// POST /api/sites/:id/cameras  { "stream": "cam1", "name": "Sân vườn" }
// Registers a camera under a site the caller's account owns.
import { getSite } from "../../../../_lib/sites.js";
import { getDb } from "../../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";
import { randomId } from "../../../../_lib/ids.js";
import { assertCapacity } from "../../../../_lib/plans.js";

export const onRequestPost = withErrorHandling(async ({ request, params, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);
  await assertCapacity(env, data.accountId, "cameras");

  const stream = (body.stream || "").trim();
  if (!stream) return errorJson("stream là bắt buộc", 400);
  const name = body.name || stream;
  const cameraId = randomId("cam");

  const db = getDb(env);
  const duplicate = await db.execute({ sql: "SELECT id FROM cameras WHERE site_id = ? AND stream = ?", args: [params.id, stream] });
  if (duplicate.rows[0]) return errorJson("Stream đã tồn tại trong site", 409);
  await db.execute({
    sql: "INSERT INTO cameras (id, site_id, account_id, stream, name) VALUES (?, ?, ?, ?, ?)",
    args: [cameraId, params.id, data.accountId, stream, name],
  });

  return json({ cameraId }, { status: 201 });
});
