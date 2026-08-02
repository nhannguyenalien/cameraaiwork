// POST /api/sites/:id/tunnel
// Provisions (or re-provisions) a real Cloudflare Named Tunnel for a site
// that already exists — e.g. migrating a site created before named-tunnel
// support existed, still on a Quick Tunnel. Doesn't touch its cameras,
// events, or relay_secret; only go2rtc_url/relay_url/cloudflare_tunnel_id
// change. Returns the tunnel token — the installer/operator writes it
// into that site's relay .env (CLOUDFLARE_TUNNEL_TOKEN) and restarts it.
import { getDb } from "../../../../_lib/db.js";
import { getSite } from "../../../../_lib/sites.js";
import { createSiteTunnel } from "../../../../_lib/cloudflareTunnel.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);

  const { tunnelId, tunnelToken, go2rtcUrl, relayUrl } = await createSiteTunnel(env, params.id);

  const db = getDb(env);
  await db.execute({
    sql: "UPDATE sites SET go2rtc_url = ?, relay_url = ?, cloudflare_tunnel_id = ? WHERE id = ?",
    args: [go2rtcUrl, relayUrl, tunnelId, params.id],
  });

  return json({ tunnelToken, go2rtcUrl, relayUrl });
});
