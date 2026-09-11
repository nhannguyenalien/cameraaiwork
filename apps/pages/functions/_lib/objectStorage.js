import { getIntegration } from "./integrations.js";
import { deleteS3, getS3, headS3, putS3 } from "./s3.js";
import { deleteGoogleDrive, getGoogleDrive, headGoogleDrive, putGoogleDrive } from "./googleDrive.js";

export async function storageChoice(env, accountId) {
  const saved = await getIntegration(env, accountId, "storage");
  if (saved?.backend === "s3" && saved.s3) return { backend: "s3" };
  if (saved?.backend === "gdrive" && saved.gdrive) return { backend: "gdrive" };
  return { backend: "r2" };
}

async function googleDriveConfig(env, accountId) {
  const saved = await getIntegration(env, accountId, "storage");
  if (!saved?.gdrive) throw new Error("Cấu hình Google Drive của tài khoản không còn khả dụng");
  return saved.gdrive;
}

async function s3Config(env, accountId) {
  const saved = await getIntegration(env, accountId, "storage");
  if (!saved?.s3) throw new Error("Cấu hình S3 của tài khoản không còn khả dụng");
  return saved.s3;
}

export async function putObject(env, accountId, backend, key, body, contentType) {
  if (backend === "s3") await putS3(await s3Config(env, accountId), key, body, contentType);
  else if (backend === "gdrive") await putGoogleDrive(await googleDriveConfig(env, accountId), key, body, contentType);
  else {
    if (!env.EVENTS_BUCKET) throw new Error("Kho R2 chưa được cấu hình");
    await env.EVENTS_BUCKET.put(key, body, { httpMetadata: { contentType } });
  }
  return key;
}

export async function headObject(env, accountId, backend, key) {
  if (backend === "s3") {
    const response = await headS3(await s3Config(env, accountId), key);
    return response && { size: Number(response.headers.get("content-length") || 0), contentType: response.headers.get("content-type") };
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
  if (backend === "s3") for (const key of keys) await deleteS3(await s3Config(env, accountId), key);
  else if (backend === "gdrive") for (const key of keys) await deleteGoogleDrive(await googleDriveConfig(env, accountId), key);
  else if (env.EVENTS_BUCKET) await env.EVENTS_BUCKET.delete(keys);
}
