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
