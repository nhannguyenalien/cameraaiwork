import { getDb } from "../../_lib/db.js";
import { cleanupOrphanTunnels, managedInfrastructure } from "../../_lib/cloudflareTunnel.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { triggerGpuScan } from "../../_lib/gpuWorker.js";
import { cleanupExpiredVideos } from "../../_lib/videoRetention.js";

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.MAINTENANCE_SECRET || bearer !== env.MAINTENANCE_SECRET) return errorJson("Unauthorized", 401);

  const rows = await getDb(env).execute({
    sql: "SELECT cloudflare_tunnel_id FROM sites WHERE cloudflare_tunnel_id IS NOT NULL",
    args: [],
  });
  const referenced = new Set(rows.rows.map((row) => row.cloudflare_tunnel_id));
  const inventory = await managedInfrastructure(env);
  const deleted = await cleanupOrphanTunnels(env, referenced, { inventory });
  const managed = {
    tunnels: inventory.tunnels.length - deleted.length,
    dnsRecords: inventory.dnsRecords.length - deleted.reduce((sum, item) => sum + item.dnsRecordsDeleted, 0),
  };
  const thresholds = {
    managedTunnels: positiveInt(env.MANAGED_TUNNEL_WARN_AT, 900),
    managedDns: positiveInt(env.MANAGED_DNS_WARN_AT, 900),
  };
  const warnings = [];
  if (managed.tunnels >= thresholds.managedTunnels) warnings.push("managed_tunnel_threshold");
  if (managed.dnsRecords >= thresholds.managedDns) warnings.push("managed_dns_threshold");
  const gpuBackfillQueued = await triggerGpuScan(env).catch((error) => {
    console.error("GPU backfill dispatch failed:", error.message || error);
    return false;
  });
  const videoRetention = await cleanupExpiredVideos(env).catch((error) => {
    console.error("Video retention cleanup failed:", error.message || error);
    return { scanned: 0, deleted: 0, errors: [{ accountId: null, backend: null, count: 0 }] };
  });

  return json({
    ok: warnings.length === 0,
    checkedAt: new Date().toISOString(),
    managed,
    account: { tunnels: inventory.accountTunnelCount, zoneCnameRecords: inventory.zoneCnameCount },
    thresholds,
    orphanTunnelsDeleted: deleted,
    warnings,
    gpuBackfillQueued,
    videoRetention,
  }, { status: warnings.length ? 503 : 200 });
});
