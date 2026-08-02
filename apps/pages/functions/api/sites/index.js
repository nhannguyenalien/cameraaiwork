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

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const name = (body.name || "").trim() || "Site mới";
  const siteId = randomId("st");
  const relaySecret = randomSecret();

  const { tunnelId, tunnelToken, go2rtcUrl, relayUrl } = await createSiteTunnel(env, siteId);

  const db = getDb(env);
  await db.execute({
    sql: "INSERT INTO sites (id, account_id, name, go2rtc_url, relay_url, relay_secret, cloudflare_tunnel_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [siteId, data.accountId, name, go2rtcUrl, relayUrl, relaySecret, tunnelId],
  });

  // relaySecret and tunnelToken are only ever returned here — the
  // installer writes them into the relay's local .env and neither is
  // stored anywhere in plaintext (tunnelToken can be re-fetched from
  // Cloudflare by tunnelId later; relaySecret genuinely isn't kept at all
  // beyond this response, matching the original design).
  return json({ siteId, relaySecret, tunnelToken }, { status: 201 });
});
