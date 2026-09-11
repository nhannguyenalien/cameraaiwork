import { getDb } from "./db.js";
import { headObject } from "./objectStorage.js";

const MAX_LIST_PAGES = 100;
const BACKENDS = ["r2", "s3", "gdrive"];

function emptyBackend(backend) {
  return {
    backend,
    eventCount: 0,
    referencedObjects: 0,
    objectCount: 0,
    totalBytes: 0,
    imageCount: 0,
    imageBytes: 0,
    videoCount: 0,
    videoBytes: 0,
    missingObjects: 0,
    unavailable: false,
    error: "",
  };
}

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
                 events.video_status, events.storage_backend, sites.name AS site_name, cameras.name AS camera_name
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
  const backendUsage = new Map(BACKENDS.map((backend) => [backend, emptyBackend(backend)]));
  let cursor;
  let truncated = false;
  if (env.EVENTS_BUCKET) {
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const listed = await env.EVENTS_BUCKET.list({ prefix: `${accountId}/`, limit: 1000, cursor });
      for (const object of listed.objects) objects.set(`r2:${object.key}`, Number(object.size || 0));
      if (!listed.truncated) break;
      cursor = listed.cursor;
      if (page === MAX_LIST_PAGES - 1) truncated = true;
    }
  }

  for (const backend of ["s3", "gdrive"]) {
    const keys = [...new Set(result.rows
      .filter((row) => row.storage_backend === backend)
      .flatMap((row) => [row.image_key, row.video_key]).filter(Boolean).map(String))];
    try {
      for (let offset = 0; offset < keys.length; offset += 20) {
        await Promise.all(keys.slice(offset, offset + 20).map(async (key) => {
          const object = await headObject(env, accountId, backend, key);
          if (object) objects.set(`${backend}:${key}`, Number(object.size || 0));
        }));
      }
    } catch (error) {
      const usage = backendUsage.get(backend);
      usage.unavailable = true;
      usage.error = error?.message || `Không kết nối được ${backend}`;
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
    const backend = BACKENDS.includes(row.storage_backend) ? row.storage_backend : "r2";
    const usage = backendUsage.get(backend);
    usage.eventCount += 1;
    const groupKey = `${row.site_id || ""}\u0000${row.camera || ""}`;
    if (!groups.has(groupKey)) groups.set(groupKey, emptyBucket(row.site_id, row.site_name, row.camera, row.camera_name));
    const group = groups.get(groupKey);
    group.events += 1;
    if (row.video_status === "recording") summary.recordingCount += 1;
    if (row.video_status === "error") summary.videoErrorCount += 1;

    for (const [kind, key] of [["image", row.image_key], ["video", row.video_key]]) {
      if (!key) continue;
      usage.referencedObjects += 1;
      const objectKey = `${backend}:${String(key)}`;
      linkedKeys.add(objectKey);
      if (!objects.has(objectKey)) {
        if (!usage.unavailable) {
          summary.missingObjects += 1;
          group.missingObjects += 1;
          usage.missingObjects += 1;
        }
        continue;
      }
      const bytes = objects.get(objectKey);
      summary.totalBytes += bytes;
      summary[`${kind}Bytes`] += bytes;
      summary[`${kind}Count`] += 1;
      group[`${kind}Bytes`] += bytes;
      group[`${kind}s`] += 1;
      usage.totalBytes += bytes;
      usage[`${kind}Bytes`] += bytes;
      usage[`${kind}Count`] += 1;
    }
  }

  for (const [key, bytes] of objects) {
    if (linkedKeys.has(key)) continue;
    summary.orphanCount += 1;
    summary.orphanBytes += bytes;
    summary.totalBytes += bytes;
    const backend = key.slice(0, key.indexOf(":"));
    const usage = backendUsage.get(backend);
    if (usage) usage.totalBytes += bytes;
  }

  for (const [key] of objects) {
    const backend = key.slice(0, key.indexOf(":"));
    const usage = backendUsage.get(backend);
    if (usage) usage.objectCount += 1;
  }

  return {
    ...summary,
    backends: BACKENDS.map((backend) => backendUsage.get(backend)),
    cameras: [...groups.values()].sort((a, b) => b.imageBytes + b.videoBytes - a.imageBytes - a.videoBytes),
    measuredAt: new Date().toISOString(),
  };
}
