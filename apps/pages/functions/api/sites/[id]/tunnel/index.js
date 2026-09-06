// POST /api/sites/:id/tunnel
// Provisions a Named Tunnel, or converges an existing one to the MVP
// one-host layout without leaking an extra tunnel.
import { getDb } from "../../../../_lib/db.js";
import { getSite } from "../../../../_lib/sites.js";
import {
  createSiteTunnel,
  consolidateSiteTunnel,
  getSiteTunnelToken,
} from "../../../../_lib/cloudflareTunnel.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);

  let tunnelId = site.cloudflare_tunnel_id;
  let tunnelToken;
  let urls;
  if (tunnelId) {
    urls = await consolidateSiteTunnel(env, params.id, tunnelId);
    tunnelToken = await getSiteTunnelToken(env, tunnelId);
  } else {
    const created = await createSiteTunnel(env, params.id);
    tunnelId = created.tunnelId;
    tunnelToken = created.tunnelToken;
    urls = created;
  }

  const db = getDb(env);
  await db.execute({
    sql: "UPDATE sites SET go2rtc_url = ?, relay_url = ?, ai_worker_url = ?, cloudflare_tunnel_id = ? WHERE id = ?",
    args: [urls.go2rtcUrl, urls.relayUrl, urls.aiWorkerUrl, tunnelId, params.id],
  });

  return json({ tunnelToken, go2rtcUrl: urls.go2rtcUrl, relayUrl: urls.relayUrl, aiWorkerUrl: urls.aiWorkerUrl });
});
