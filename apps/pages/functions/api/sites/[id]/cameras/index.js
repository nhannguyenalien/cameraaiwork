// POST /api/sites/:id/cameras  { "stream": "cam1", "name": "Sân vườn" }
// Registers a camera under a site the caller's account owns.
import { getSite } from "../../../../_lib/sites.js";
import { getDb } from "../../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, params, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);

  const stream = (body.stream || "").trim();
  if (!stream) return errorJson("stream là bắt buộc", 400);
  const name = body.name || stream;
  // No ":" — see the note in functions/api/sites/index.js. account/site
  // scoping already comes from the site_id/account_id columns.
  const cameraId = `cam-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const db = getDb(env);
  await db.execute({
    sql: "INSERT INTO cameras (id, site_id, account_id, stream, name) VALUES (?, ?, ?, ?, ?)",
    args: [cameraId, params.id, data.accountId, stream, name],
  });

  return json({ cameraId }, { status: 201 });
});
