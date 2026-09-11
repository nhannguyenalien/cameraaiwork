const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function required(value, name) {
  const clean = String(value || "").trim();
  if (!clean) throw new Error(`${name} là bắt buộc`);
  return clean;
}

export function validateGoogleDriveConfig(input) {
  const accessToken = required(input?.accessToken, "Google OAuth access token");
  const folderId = required(input?.folderId, "Google Drive Folder ID");
  if (/\s/.test(accessToken)) throw new Error("Google OAuth access token không hợp lệ");
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) throw new Error("Google Drive Folder ID không hợp lệ");
  return { accessToken, folderId };
}

function headers(config, extra = {}) {
  return { authorization: `Bearer ${config.accessToken}`, ...extra };
}

async function ensureOk(response, action) {
  if (response.ok) return response;
  const detail = await response.text().catch(() => "");
  throw new Error(`${action} Google Drive thất bại (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFile(config, key) {
  const q = `'${escapeQuery(config.folderId)}' in parents and trashed = false and appProperties has { key='cameraaiObjectKey' and value='${escapeQuery(key)}' }`;
  const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const response = await ensureOk(await fetch(url, { headers: headers(config) }), "Tìm file trên");
  const data = await response.json();
  return data.files?.[0] || null;
}

function fileName(key) {
  return String(key).split("/").pop() || "cameraai-object";
}

export async function putGoogleDrive(config, key, body, contentType) {
  const existing = await findFile(config, key);
  const metadata = existing ? null : {
    name: fileName(key),
    parents: [config.folderId],
    appProperties: { cameraaiObjectKey: String(key) },
  };
  const endpoint = existing
    ? `${UPLOAD_API}/files/${encodeURIComponent(existing.id)}?uploadType=resumable&supportsAllDrives=true`
    : `${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true`;
  const init = await ensureOk(await fetch(endpoint, {
    method: existing ? "PATCH" : "POST",
    headers: headers(config, {
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": contentType || "application/octet-stream",
    }),
    body: JSON.stringify(metadata || {}),
  }), "Khởi tạo upload lên");
  const location = init.headers.get("location");
  if (!location) throw new Error("Google Drive không trả về URL upload");
  await ensureOk(await fetch(location, {
    method: "PUT",
    headers: { "content-type": contentType || "application/octet-stream" },
    body,
  }), "Upload lên");
}

export async function headGoogleDrive(config, key) {
  return findFile(config, key);
}

export async function getGoogleDrive(config, key, range) {
  const file = await findFile(config, key);
  if (!file) return null;
  const response = await fetch(`${API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
    headers: headers(config, range ? { range } : {}),
  });
  if (response.status === 404) return null;
  return ensureOk(response, "Đọc file từ");
}

export async function deleteGoogleDrive(config, key) {
  const file = await findFile(config, key);
  if (!file) return;
  await ensureOk(await fetch(`${API}/files/${encodeURIComponent(file.id)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: headers(config),
  }), "Xóa file trên");
}

export async function testGoogleDrive(config) {
  const key = `.cameraaiwork-test-${crypto.randomUUID()}`;
  await putGoogleDrive(config, key, new TextEncoder().encode("CameraAIWork"), "text/plain");
  const found = await headGoogleDrive(config, key);
  if (!found) throw new Error("Kiểm tra Google Drive thất bại: không đọc lại được file thử");
  await deleteGoogleDrive(config, key);
}
