// POST /api/sites/:id/cameras — configure locally, then register in cloud DB.
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

  if (!site.relay_url) return errorJson("Site chưa kết nối relay", 409);
  const name = String(body.name || "Camera mới").trim();
  if (!name || name.length > 120) return errorJson("Tên camera phải có từ 1 đến 120 ký tự", 400);
  const cameraId = randomId("cam");
  const stream = cameraId;

  const db = getDb(env);
  const relayResponse = await fetch(`${site.relay_url}/config/cameras/${encodeURIComponent(stream)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-relay-secret": site.relay_secret },
    body: JSON.stringify(body),
  });
  if (!relayResponse.ok) {
    const detail = await relayResponse.json().catch(() => ({}));
    return errorJson(detail.error || "Không cấu hình được camera tại site", relayResponse.status >= 500 ? 502 : relayResponse.status);
  }
  await db.execute({
    sql: "INSERT INTO cameras (id, site_id, account_id, stream, name) VALUES (?, ?, ?, ?, ?)",
    args: [cameraId, params.id, data.accountId, stream, name],
  });

  return json({ cameraId }, { status: 201 });
});
