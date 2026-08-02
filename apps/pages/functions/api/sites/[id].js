// PATCH /api/sites/:id  { "go2rtcUrl": "...", "relayUrl": "..." }
// Called by the relay itself (not the dashboard/account API key) every
// time it starts, since Cloudflare Quick Tunnel hostnames change on every
// restart. Authenticated with that site's own relay_secret — same pattern
// as /api/motion. Exempted from the account-API-key check in
// functions/_middleware.js.
import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPatch = withErrorHandling(async ({ request, params, env }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const { go2rtcUrl, relayUrl } = body;
  if (!go2rtcUrl || !relayUrl) {
    return errorJson("go2rtcUrl và relayUrl là bắt buộc", 400);
  }

  const db = getDb(env);
  const existing = await db.execute({
    sql: "SELECT relay_secret FROM sites WHERE id = ?",
    args: [params.id],
  });
  const site = existing.rows[0];

  if (!site || request.headers.get("x-relay-secret") !== site.relay_secret) {
    return errorJson("Unauthorized", 401);
  }

  await db.execute({
    sql: "UPDATE sites SET go2rtc_url = ?, relay_url = ? WHERE id = ?",
    args: [go2rtcUrl, relayUrl, params.id],
  });

  return json({ ok: true });
});
