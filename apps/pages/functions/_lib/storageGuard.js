import { getDb } from "./db.js";
import { getIntegration } from "./integrations.js";
import { getGoogleDriveRemaining } from "./objectStorage.js";
import { evictOldestVideos } from "./storageQuota.js";
import { storageConnections, storageProvider } from "./storagePolicy.js";
import { cleanupExpiredSummaries, cleanupExpiredVideos } from "./videoRetention.js";

const MiB = 1024 * 1024;
// Keep a Drive from ever reaching 0 bytes free (that is what made every clip
// fail at once): below LOW we delete the oldest clips until TARGET is free.
export const LOW_SPACE_BYTES = 512 * MiB;
export const TARGET_FREE_BYTES = 1024 * MiB;
const EVICT_BATCH = 25;
const MAX_ROUNDS = 12;

// Free space on every connected Google Drive of one account, oldest video
// first. Opt-out via storage integration `autoEvict === false`.
export async function reclaimLowDriveSpace(env, accountId, { low = LOW_SPACE_BYTES, target = TARGET_FREE_BYTES } = {}) {
  const saved = await getIntegration(env, accountId, "storage");
  if (!saved || saved.autoEvict === false) return [];
  const results = [];
  for (const connection of storageConnections(saved)) {
    if (storageProvider(connection.id) !== "gdrive") continue;
    try {
      let remaining = await getGoogleDriveRemaining(env, accountId, connection.id);
      if (remaining == null || remaining >= low) continue;
      let evicted = 0;
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const count = await evictOldestVideos(env, accountId, connection.id, EVICT_BATCH);
        if (!count) break;
        evicted += count;
        remaining = await getGoogleDriveRemaining(env, accountId, connection.id);
        if (remaining == null || remaining >= target) break;
      }
      results.push({ accountId, backend: connection.id, evicted, remainingBytes: remaining });
    } catch (error) {
      console.error(`[storage-guard] account=${accountId} backend=${connection.id}:`, error.message || error);
    }
  }
  return results;
}

// Periodic job: (1) time-based expiry until the backlog is drained, (2) keep
// headroom on customers' Drives so writes never hit "storage full".
export async function runStorageMaintenance(env, { budgetMs = 4 * 60_000, batch = 250 } = {}) {
  const started = Date.now();
  const summary = { expired: 0, expiryErrors: 0, summariesExpired: 0, reclaimed: [] };
  while (Date.now() - started < budgetMs) {
    const result = await cleanupExpiredVideos(env, batch).catch((error) => {
      console.error("[storage-maintenance] expiry failed:", error.message || error);
      return { scanned: 0, deleted: 0, errors: [{}] };
    });
    summary.expired += result.deleted;
    summary.expiryErrors += result.errors.length;
    if (result.scanned < batch || result.deleted === 0) break;
  }
  const summaries = await cleanupExpiredSummaries(env).catch((error) => {
    console.error("[storage-maintenance] summary expiry failed:", error.message || error);
    return { deleted: 0, errors: [{}] };
  });
  summary.summariesExpired = summaries.deleted;
  summary.expiryErrors += summaries.errors.length;
  const accounts = await getDb(env, "_lib.storageGuard").execute({
    sql: "SELECT DISTINCT account_id FROM account_integrations WHERE provider = 'storage'", args: [],
  });
  for (const row of accounts.rows) {
    if (Date.now() - started > budgetMs * 2) break;
    summary.reclaimed.push(...await reclaimLowDriveSpace(env, row.account_id));
  }
  return summary;
}
