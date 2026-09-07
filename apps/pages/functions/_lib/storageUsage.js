import { getDb } from "./db.js";

const MAX_LIST_PAGES = 100;

function emptyBucket(siteId, siteName, camera, cameraName) {
  return {
    siteId,
    siteName: siteName || siteId || "Không xác định",
    camera,
    cameraName: cameraName || camera || "Không xác định",
    events: 0,
    images: 0,
    imageBytes: 0,
    videos: 0,
    videoBytes: 0,
    missingObjects: 0,
  };
}

export async function storageUsage(env, accountId) {
  const result = await getDb(env).execute({
    sql: `SELECT events.id, events.site_id, events.camera, events.image_key, events.video_key,
                 events.video_status, sites.name AS site_name, cameras.name AS camera_name
          FROM events
          LEFT JOIN sites ON sites.id = events.site_id AND sites.account_id = events.account_id
          LEFT JOIN cameras ON cameras.site_id = events.site_id
                           AND cameras.stream = events.camera
                           AND cameras.account_id = events.account_id
          WHERE events.account_id = ?
          ORDER BY events.id DESC`,
    args: [accountId],
  });

  const objects = new Map();
  let cursor;
  let truncated = false;
  if (env.EVENTS_BUCKET) {
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const listed = await env.EVENTS_BUCKET.list({ prefix: `${accountId}/`, limit: 1000, cursor });
      for (const object of listed.objects) objects.set(object.key, Number(object.size || 0));
      if (!listed.truncated) break;
      cursor = listed.cursor;
      if (page === MAX_LIST_PAGES - 1) truncated = true;
    }
  }

  const linkedKeys = new Set();
  const groups = new Map();
  const summary = {
    totalBytes: 0,
    objectCount: objects.size,
    imageBytes: 0,
    imageCount: 0,
    videoBytes: 0,
    videoCount: 0,
    eventCount: result.rows.length,
    recordingCount: 0,
    videoErrorCount: 0,
    missingObjects: 0,
    orphanBytes: 0,
    orphanCount: 0,
    truncated,
  };

  for (const row of result.rows) {
    const groupKey = `${row.site_id || ""}\u0000${row.camera || ""}`;
    if (!groups.has(groupKey)) groups.set(groupKey, emptyBucket(row.site_id, row.site_name, row.camera, row.camera_name));
    const group = groups.get(groupKey);
    group.events += 1;
    if (row.video_status === "recording") summary.recordingCount += 1;
    if (row.video_status === "error") summary.videoErrorCount += 1;

    for (const [kind, key] of [["image", row.image_key], ["video", row.video_key]]) {
      if (!key) continue;
      linkedKeys.add(String(key));
      if (!objects.has(String(key))) {
        summary.missingObjects += 1;
        group.missingObjects += 1;
        continue;
      }
      const bytes = objects.get(String(key));
      summary.totalBytes += bytes;
      summary[`${kind}Bytes`] += bytes;
      summary[`${kind}Count`] += 1;
      group[`${kind}Bytes`] += bytes;
      group[`${kind}s`] += 1;
    }
  }

  for (const [key, bytes] of objects) {
    if (linkedKeys.has(key)) continue;
    summary.orphanCount += 1;
    summary.orphanBytes += bytes;
    summary.totalBytes += bytes;
  }

  return {
    ...summary,
    cameras: [...groups.values()].sort((a, b) => b.imageBytes + b.videoBytes - a.imageBytes - a.videoBytes),
    measuredAt: new Date().toISOString(),
  };
}
