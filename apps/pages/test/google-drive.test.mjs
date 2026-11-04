import test from "node:test";
import assert from "node:assert/strict";
import { deleteGoogleDrive, getGoogleDrive, headGoogleDrive, putGoogleDrive, validateGoogleDriveConfig } from "../functions/_lib/googleDrive.js";

test("validates Google Drive token and folder", () => {
  assert.deepEqual(validateGoogleDriveConfig({ accessToken: " token-123 ", folderId: "folder_ABC-123" }), {
    accessToken: "token-123",
    folderId: "folder_ABC-123",
  });
  assert.throws(() => validateGoogleDriveConfig({ accessToken: "", folderId: "folder" }), /bắt buộc/);
  assert.throws(() => validateGoogleDriveConfig({ accessToken: "token", folderId: "bad folder" }), /không hợp lệ/);
});

test("creates, reads, and deletes a Drive object by its CameraAI key", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/files?") && !String(url).includes("upload")) {
      const exists = calls.filter((call) => String(call.url).includes("upload-session")).length > 0;
      return Response.json({ files: exists ? [{ id: "drive-file", name: "1.jpg", mimeType: "image/jpeg", size: "3" }] : [] });
    }
    if (String(url).includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://upload-session" } });
    if (String(url) === "https://upload-session") return Response.json({ id: "drive-file" });
    if (String(url).includes("alt=media")) return new Response("abc", { headers: { "content-type": "image/jpeg", "content-length": "3" } });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const config = { accessToken: "token", folderId: "folder" };
  await putGoogleDrive(config, "account/1.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
  assert.equal((await headGoogleDrive(config, "account/1.jpg")).size, "3");
  assert.equal(await (await getGoogleDrive(config, "account/1.jpg")).text(), "abc");
  await deleteGoogleDrive(config, "account/1.jpg");
  assert.ok(calls.some((call) => call.init.method === "DELETE"));
  assert.ok(calls.every((call) => !call.init.headers?.authorization || call.init.headers.authorization === "Bearer token"));
});

test("folder verification reports exhausted Drive quota instead of an internal server error", async (t) => {
  const { testGoogleDrive } = await import("../functions/_lib/googleDrive.js");
  const { withErrorHandling } = await import("../functions/_lib/http.js");
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("uploadType=resumable")) {
      return new Response(null, { headers: { location: "https://upload-session" } });
    }
    if (String(url) === "https://upload-session") {
      return Response.json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, { status: 403 });
    }
    return Response.json({ files: [] });
  });
  const response = await withErrorHandling(() => testGoogleDrive({ accessToken: "test-token", folderId: "folder" }))({});
  assert.equal(response.status, 409);
  const { error } = await response.json();
  assert.match(error, /Google Drive đã hết dung lượng/);
  assert.doesNotMatch(error, /Internal server error|test-token/);
});

test("Drive usage paginates camera files and subtracts all Google usage from quota", async (t) => {
  const { googleDriveUsage } = await import('../functions/_lib/googleDrive.js');
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/about?')) return Response.json({ storageQuota: { limit: '1000', usage: '900', usageInDrive: '500' } });
    const second = new URL(url).searchParams.get('pageToken');
    return Response.json(second ? { files: [{ size: '200', appProperties: { cameraaiObjectKey: 'acct/2' } }] } : {
      nextPageToken: 'next', files: [
        { size: '100', appProperties: { cameraaiObjectKey: 'acct/1' } },
        { size: '99', appProperties: { cameraaiObjectKey: 'other/1' } },
        { size: '55' },
      ],
    });
  });
  assert.deepEqual(await googleDriveUsage({ accessToken: 'token', folderId: 'folder' }, 'acct'), {
    limitBytes: 1000, usedBytes: 900, driveBytes: 500, remainingBytes: 100, cameraBytes: 300, cameraPartial: false,
  });
});

test("Drive quota without a limit stays unknown and file-list failure preserves quota", async (t) => {
  const { googleDriveUsage } = await import('../functions/_lib/googleDrive.js');
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/about?')) return Response.json({ storageQuota: { usage: '900' } });
    throw new Error('timeout');
  });
  const usage = await googleDriveUsage({ accessToken: 'token', folderId: 'folder' }, 'acct');
  assert.equal(usage.limitBytes, null);
  assert.equal(usage.remainingBytes, null);
  assert.equal(usage.cameraBytes, null);
  assert.equal(usage.usedBytes, 900);
});

 test("Drive parent permission rejection is actionable rather than HTTP 500", async (t) => {
  const { withErrorHandling } = await import("../functions/_lib/http.js");
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("uploadType=resumable")) return new Response(null, { headers: { location: "https://upload-session" } });
    if (String(url) === "https://upload-session") return Response.json({ error: { errors: [{ reason: "insufficientParentPermissions" }] } }, { status: 403 });
    return Response.json({ files: [] });
  });
  const response = await withErrorHandling(() => putGoogleDrive({ accessToken: "secret-token", folderId: "folder" }, "test", "test", "text/plain"))({});
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Không có quyền ghi/);
});

test("Picker config identifies the OAuth project without exposing its secret", async () => {
  const { onRequestGet } = await import("../functions/api/settings/storage-config/google-client-info.js");
  const response = await onRequestGet({ env: { GOOGLE_OAUTH_CLIENT_ID: "123456-client.apps.googleusercontent.com", GOOGLE_PICKER_API_KEY: "public-picker-key", GOOGLE_OAUTH_CLIENT_SECRET: "secret" } });
  assert.deepEqual(await response.json(), { appId: "123456", clientId: "123456-client.apps.googleusercontent.com", pickerApiKey: "public-picker-key" });
});
