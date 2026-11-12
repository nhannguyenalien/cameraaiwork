// Estimates how many days of video the account's writable storage can really
// hold at the current recording rate, so the dashboard can warn when the
// configured retention (default 7 days) cannot be honoured.
const MIN_SAMPLE_DAYS = 1;

export function estimateRetention({ capacityBytes, nonVideoBytes = 0, dailyVideoBytes, configuredDays }) {
  const configured = Number(configuredDays) || 7;
  if (capacityBytes == null) return { status: "unknown", configuredDays: configured, maxDays: null, dailyVideoBytes: dailyVideoBytes || 0 };
  if (!(dailyVideoBytes > 0)) return { status: "no-data", configuredDays: configured, maxDays: null, dailyVideoBytes: 0 };
  const room = Math.max(0, capacityBytes - Math.max(0, nonVideoBytes));
  const maxDays = Math.round((room / dailyVideoBytes) * 10) / 10;
  const status = maxDays < MIN_SAMPLE_DAYS ? "critical" : maxDays < configured ? "warning" : "ok";
  return { status, configuredDays: configured, maxDays, dailyVideoBytes: Math.round(dailyVideoBytes), capacityBytes, roomBytes: room };
}

// Sum capacity usable by camera data across the write chain. Returns null when
// any backend in the chain has no knowable limit (S3, unreadable Drive quota):
// an unbounded tail means retention is not capacity-limited.
export function chainCapacityBytes(chain, backends, r2QuotaBytes) {
  let total = 0;
  for (const id of chain) {
    const usage = backends.find((item) => item.backend === id);
    if (id === "r2") { total += r2QuotaBytes; continue; }
    if ((usage?.provider || "") === "gdrive" && usage.driveQuota?.remainingBytes != null) {
      total += usage.driveQuota.remainingBytes + (usage.driveQuota.cameraBytes ?? usage.totalBytes ?? 0);
      continue;
    }
    return null;
  }
  return total;
}
