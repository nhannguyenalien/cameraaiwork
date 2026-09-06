// DELETE /api/sites/:id
// Tears down the site's Cloudflare Tunnel + DNS records (if any) and
// removes it — cameras/events under it go too (no FK cascade configured,
// so this deletes them explicitly).
import { getDb } from "../../_lib/db.js";
import { getSite } from "../../_lib/sites.js";
import { deleteSiteTunnel } from "../../_lib/cloudflareTunnel.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestDelete = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);

  if (site.cloudflare_tunnel_id || env.TUNNEL_BASE_DOMAIN) {
    await deleteSiteTunnel(env, params.id, site.cloudflare_tunnel_id);
  }

  const db = getDb(env);
  await db.execute({ sql: "DELETE FROM events WHERE site_id = ?", args: [params.id] });
  await db.execute({ sql: "DELETE FROM cameras WHERE site_id = ?", args: [params.id] });
  await db.execute({ sql: "DELETE FROM sites WHERE id = ?", args: [params.id] });

  return json({ ok: true });
});
