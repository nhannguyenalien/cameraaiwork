// POST /api/sites  { "name": "Nhà chính" }
// Self-service site registration — used by apps/relay/install.sh so
// onboarding a new site is "run the installer", not "hand-edit Turso" or
// touch Cloudflare's dashboard. Provisions a real Cloudflare Named Tunnel
// server-side (our own Cloudflare account/domain — the customer never
// needs their own) with a stable hostname, so go2rtc_url/relay_url are
// known immediately, not filled in later by a self-registering relay.
import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { randomId, randomSecret } from "../../_lib/ids.js";
import { createSiteTunnel } from "../../_lib/cloudflareTunnel.js";
import { assertCapacity } from "../../_lib/plans.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const result = await getDb(env).execute({
    sql: `SELECT s.id, s.name, s.go2rtc_url, s.relay_url, s.ai_worker_url,
                 COUNT(c.id) AS camera_count
          FROM sites s LEFT JOIN cameras c ON c.site_id = s.id
          WHERE s.account_id = ? GROUP BY s.id ORDER BY s.name, s.id`,
    args: [data.accountId],
  });
  return json(result.rows);
});

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const name = (body.name || "").trim() || "Site mới";
  await assertCapacity(env, data.accountId, "sites");
  const siteId = randomId("st");
  const relaySecret = randomSecret();

  const { tunnelId, tunnelToken, go2rtcUrl, relayUrl, aiWorkerUrl } = await createSiteTunnel(env, siteId);

  const db = getDb(env);
  await db.execute({
    sql: "INSERT INTO sites (id, account_id, name, go2rtc_url, relay_url, ai_worker_url, relay_secret, cloudflare_tunnel_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [siteId, data.accountId, name, go2rtcUrl, relayUrl, aiWorkerUrl, relaySecret, tunnelId],
  });

  // Both secrets are returned only to the installer. relaySecret is also
  // retained server-side because Pages must sign live URLs and authenticate
  // internal capture/AI requests; it is never returned by list/read APIs.
  // The tunnel token can be re-fetched from Cloudflare using tunnelId.
  return json({ siteId, relaySecret, tunnelToken }, { status: 201 });
});
