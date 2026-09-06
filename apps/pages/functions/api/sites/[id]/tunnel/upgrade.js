import { getDb } from "../../../../_lib/db.js";
import { consolidateSiteTunnel } from "../../../../_lib/cloudflareTunnel.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ env, data, params }) => {
  const db = getDb(env);
  const found = await db.execute({
    sql: "SELECT id, cloudflare_tunnel_id FROM sites WHERE id = ? AND account_id = ?",
    args: [params.id, data.accountId],
  });
  const site = found.rows[0];
  if (!site) return errorJson("Site not found", 404);

  const urls = await consolidateSiteTunnel(env, site.id, site.cloudflare_tunnel_id);
  await db.execute({
    sql: "UPDATE sites SET go2rtc_url = ?, relay_url = ?, ai_worker_url = ? WHERE id = ? AND account_id = ?",
    args: [urls.go2rtcUrl, urls.relayUrl, urls.aiWorkerUrl, site.id, data.accountId],
  });
  return json({ ok: true, ...urls });
});
