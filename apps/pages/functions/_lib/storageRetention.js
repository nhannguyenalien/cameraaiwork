// Estimates how many days of video the account's writable storage can really
// hold at the current recording rate, so the dashboard can warn when the
// configured retention (default 7 days) cannot be honoured.
const MIN_SAMPLE_DAYS = 1;

export function estimateRetention({ capacityBytes, nonVideoBytes = 0, dailyVideoBytes, configuredDays, partial = false }) {
  const configured = Number(configuredDays) || 7;
  if (capacityBytes == null) return { status: "unknown", configuredDays: configured, maxDays: null, dailyVideoBytes: dailyVideoBytes || 0 };
  if (!(dailyVideoBytes > 0)) return { status: "no-data", configuredDays: configured, maxDays: null, dailyVideoBytes: 0 };
  const room = Math.max(0, capacityBytes - Math.max(0, nonVideoBytes));
  const maxDays = Math.round((room / dailyVideoBytes) * 10) / 10;
  const status = maxDays < MIN_SAMPLE_DAYS ? "critical" : maxDays < configured ? "warning" : "ok";
  return { status, configuredDays: configured, maxDays, dailyVideoBytes: Math.round(dailyVideoBytes), capacityBytes, roomBytes: room, partial };
}

// Capacity usable by camera data across the write chain, counting only
// backends whose limit is knowable (R2 quota, Drive remaining + camera bytes).
// Backends without a limit (S3, unreadable Drive quota) are skipped and flagged
// via `partial`, so the dashboard still warns about the bounded ones.
export function chainCapacity(chain, backends, r2QuotaBytes) {
  let capacityBytes = 0;
  let nonVideoBytes = 0;
  let partial = false;
  let counted = 0;
  for (const id of chain) {
    const usage = backends.find((item) => item.backend === id);
    let capacity = null;
    if (id === "r2") capacity = r2QuotaBytes;
    else if ((usage?.provider || "") === "gdrive" && usage.driveQuota?.remainingBytes != null) {
      capacity = usage.driveQuota.remainingBytes + (usage.driveQuota.cameraBytes ?? usage.totalBytes ?? 0);
    }
    if (capacity == null) { partial = true; continue; }
    capacityBytes += capacity;
    nonVideoBytes += Math.max(0, (usage?.totalBytes || 0) - (usage?.videoBytes || 0));
    counted += 1;
  }
  return { capacityBytes: counted ? capacityBytes : null, nonVideoBytes, partial };
}
