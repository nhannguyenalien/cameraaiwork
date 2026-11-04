import { getIntegration } from "./integrations.js";
import { deleteS3, getS3, headS3, putS3 } from "./s3.js";
import { googleDriveUsage, deleteGoogleDrive, getGoogleDrive, headGoogleDrive, putGoogleDrive } from "./googleDrive.js";
import { refreshGoogleAccessToken } from "./googleAuth.js";
import { ensureR2Capacity } from "./storageQuota.js";

import { effectivePlanForAccount } from "./plans.js";
import { storagePolicy } from "./storagePolicy.js";

export async function resolveStorageChain(env, accountId) {
  const [saved, plan] = await Promise.all([
    getIntegration(env, accountId, "storage"), effectivePlanForAccount(env, accountId),
  ]);
  return storagePolicy(saved, plan, Boolean(env.EVENTS_BUCKET)).writeChain;
}

// The account only ever holds a long-lived refresh_token (see
// functions/api/settings/storage-config/google-callback.js) — every call
// resolves it to a fresh ~1h access token on demand, so the connection
// keeps working indefinitely without the customer re-authorizing.
async function googleDriveConfig(env, accountId) {
  const saved = await getIntegration(env, accountId, "storage");
  if (!saved?.gdrive?.refreshToken) throw new Error("Cấu hình Google Drive của tài khoản không còn khả dụng");
  const accessToken = await refreshGoogleAccessToken(env, saved.gdrive.refreshToken);
  return { accessToken, folderId: saved.gdrive.folderId };
}

async function s3Config(env, accountId) {
  const saved = await getIntegration(env, accountId, "storage");
  if (!saved?.s3) throw new Error("Cấu hình S3 của tài khoản không còn khả dụng");
  return saved.s3;
}

export async function putObject(env, accountId, backend, key, body, contentType, signal) {
  if (backend === "s3") await putS3(await s3Config(env, accountId), key, body, contentType, signal);
  else if (backend === "gdrive") await putGoogleDrive(await googleDriveConfig(env, accountId), key, body, contentType, signal);
  else {
    if (!env.EVENTS_BUCKET) throw new Error("Kho R2 chưa được cấu hình");
    await ensureR2Capacity(env, accountId, body?.byteLength || 0);
    await env.EVENTS_BUCKET.put(key, body, { httpMetadata: { contentType } });
  }
  return key;
}

// Per-attempt ceiling for an external (network) backend so a hung S3/Drive
// origin (e.g. a dead Cloudflare Tunnel behind it) can't stall the whole
// chain — the request is aborted and the next candidate tried instead.
// R2 is a same-account Worker binding, not a network hop, so it has no
// timeout here.
const STORAGE_ATTEMPT_TIMEOUT_MS = 8000;

// Try the destinations permitted by the current plan, in configured order.
// Reading and deleting historical objects do not depend on this write policy.
export async function putObjectWithFallback(env, accountId, chain, key, body, contentType, label = "object") {
  let lastErr;
  for (const backend of chain) {
    const controller = backend === "r2" ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), STORAGE_ATTEMPT_TIMEOUT_MS) : null;
    try {
      await putObject(env, accountId, backend, key, body, contentType, controller?.signal);
      return { key, backend };
    } catch (err) {
      lastErr = err;
      console.error(`[storage-fallback] account=${accountId} backend=${backend} upload ${label} thất bại, chuyển sang backend kế tiếp:`, err.message || err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Không có backend lưu trữ nào khả dụng");
}

export async function headObject(env, accountId, backend, key) {
  if (backend === "s3") {
    const config = await s3Config(env, accountId);
    try {
      const response = await headS3(config, key);
      return response && { size: Number(response.headers.get("content-length") || 0), contentType: response.headers.get("content-type") };
    } catch {
      // Some S3-compatible providers reject signed HEAD requests (403) even
      // though the identical signing works fine for GET. Fall back to a
      // 1-byte ranged GET and read the real size from Content-Range so
      // event video playback (which needs headObject for Range support)
      // still works against those providers.
      const response = await getS3(config, key, "bytes=0-0");
      if (!response) return null;
      const contentRange = response.headers.get("content-range");
      const size = contentRange
        ? Number(contentRange.split("/")[1])
        : Number(response.headers.get("content-length") || 0);
      return { size, contentType: response.headers.get("content-type") };
    }
  }
  if (backend === "gdrive") {
    const file = await headGoogleDrive(await googleDriveConfig(env, accountId), key);
    return file && { size: Number(file.size || 0), contentType: file.mimeType };
  }
  return env.EVENTS_BUCKET?.head(key);
}

export async function getObject(env, accountId, backend, key, range) {
  if (backend === "s3") {
    const response = await getS3(await s3Config(env, accountId), key, range ? `bytes=${range.start}-${range.end}` : undefined);
    return response && { body: response.body, size: Number(response.headers.get("content-length") || 0), contentType: response.headers.get("content-type") };
  }
  if (backend === "gdrive") {
    const response = await getGoogleDrive(await googleDriveConfig(env, accountId), key, range ? `bytes=${range.start}-${range.end}` : undefined);
    return response && { body: response.body, size: Number(response.headers.get("content-length") || 0), contentType: response.headers.get("content-type") };
  }
  const object = await env.EVENTS_BUCKET?.get(key, range ? { range: { offset: range.start, length: range.length } } : undefined);
  return object && { body: object.body, size: object.size, contentType: object.httpMetadata?.contentType };
}

export async function deleteObjects(env, accountId, backend, keys) {
  if (!keys.length) return;
  // Resolve the config once per call, not once per key — matters more now
  // that the gdrive branch does a real network token refresh.
  if (backend === "s3") {
    const config = await s3Config(env, accountId);
    for (const key of keys) await deleteS3(config, key);
  } else if (backend === "gdrive") {
    const config = await googleDriveConfig(env, accountId);
    for (const key of keys) await deleteGoogleDrive(config, key);
  } else {
    if (!env.EVENTS_BUCKET) throw new Error("Kho R2 chưa được cấu hình");
    await env.EVENTS_BUCKET.delete(keys);
  }
}

export async function getGoogleDriveUsage(env, accountId) {
  const saved = await getIntegration(env, accountId, "storage");
  if (!saved?.gdrive?.refreshToken) return null;
  return googleDriveUsage(await googleDriveConfig(env, accountId), accountId);
}
