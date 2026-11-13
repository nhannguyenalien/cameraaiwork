import test from "node:test";
import assert from "node:assert/strict";
import { estimateRetention, chainCapacity } from "../functions/_lib/storageRetention.js";

const GB = 1024 ** 3;

test("1 GB with heavy recording only holds under a day", () => {
  const r = estimateRetention({ capacityBytes: GB, nonVideoBytes: 0.1 * GB, dailyVideoBytes: 2 * GB, configuredDays: 7 });
  assert.equal(r.status, "critical");
  assert.ok(r.maxDays < 1);
});
test("warns when capacity covers fewer days than configured", () => {
  const r = estimateRetention({ capacityBytes: 10 * GB, dailyVideoBytes: 2 * GB, configuredDays: 7 });
  assert.equal(r.status, "warning");
  assert.equal(r.maxDays, 5);
});
test("ok when enough room; unknown when capacity unbounded; no-data without recordings", () => {
  assert.equal(estimateRetention({ capacityBytes: 100 * GB, dailyVideoBytes: GB, configuredDays: 7 }).status, "ok");
  assert.equal(estimateRetention({ capacityBytes: null, dailyVideoBytes: GB, configuredDays: 7 }).status, "unknown");
  assert.equal(estimateRetention({ capacityBytes: GB, dailyVideoBytes: 0, configuredDays: 7 }).status, "no-data");
});
test("chain capacity sums r2 and drive; S3 is skipped and flagged partial", () => {
  const backends = [
    { backend: "gdrive", provider: "gdrive", totalBytes: 5 * GB, videoBytes: 4 * GB, driveQuota: { remainingBytes: 0, cameraBytes: 5 * GB } },
    { backend: "s3", provider: "s3", totalBytes: GB, videoBytes: GB },
    { backend: "r2", totalBytes: GB, videoBytes: GB },
  ];
  assert.deepEqual(chainCapacity(["gdrive", "r2"], backends, GB), { capacityBytes: 6 * GB, nonVideoBytes: GB, partial: false });
  assert.deepEqual(chainCapacity(["gdrive", "s3", "r2"], backends, GB), { capacityBytes: 6 * GB, nonVideoBytes: GB, partial: true });
  assert.equal(chainCapacity(["s3"], backends, GB).capacityBytes, null);
});
test("full Drives + R2 with S3 in the chain still produce a warning", () => {
  const backends = [
    { backend: "gdrive", provider: "gdrive", totalBytes: 0.3 * GB, videoBytes: 0.3 * GB, driveQuota: { remainingBytes: 0, cameraBytes: 5 * GB } },
    { backend: "r2", totalBytes: GB, videoBytes: GB },
  ];
  const cap = chainCapacity(["gdrive", "s3", "r2"], backends, GB);
  const r = estimateRetention({ ...cap, dailyVideoBytes: 2.3 * GB, configuredDays: 7 });
  assert.equal(r.status, "warning");
  assert.ok(r.maxDays < 7 && r.maxDays > 1);
  assert.equal(r.partial, true);
});

import { encryptConfig } from "../functions/_lib/integrations.js";
import { putObjectWithFallback } from "../functions/_lib/objectStorage.js";

async function evictionEnv(autoEvict) {
  const env = { CUSTOMER_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"), GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" };
  const saved = { backend: "gdrive", gdrive: { refreshToken: "rt", folderId: "folder" } };
  if (autoEvict !== undefined) saved.autoEvict = autoEvict;
  const encrypted = await encryptConfig(env, saved);
  const events = [{ id: 1, video_key: "a/old1.mp4" }, { id: 2, video_key: "a/old2.mp4" }];
  const log = { deleted: [], expired: [] };
  const unsafe = async (sql, args) => {
    if (sql.includes("SELECT encrypted_config")) return [{ encrypted_config: encrypted }];
    if (sql.includes("FROM events")) return events.splice(0, 1);
    if (sql.includes("UPDATE events")) { log.expired.push(args[0]); return []; }
    throw new Error(`Unexpected query: ${sql}`);
  };
  env.DB_CLIENT = { unsafe, begin: async (fn) => Promise.all(fn({ unsafe })) };
  return { env, log };
}

function mockDrive(t, log, quotaFailures) {
  let failures = quotaFailures;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const u = String(url);
    if (u.includes("oauth2")) return Response.json({ access_token: "tok" });
    if (init.method === "DELETE") { log.deleted.push(u); return new Response(null, { status: 204 }); }
    if (u.includes("/files?") && !u.includes("upload")) return Response.json({ files: u.includes("old") || u.includes(encodeURIComponent("old")) ? [{ id: "f" }] : [] });
    if (u.includes("uploadType=resumable")) return new Response(null, { headers: { location: "https://session" } });
    if (u === "https://session") {
      if (failures-- > 0) return Response.json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, { status: 403 });
      return Response.json({ id: "new" });
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });
}

test("Drive full + autoEvict: deletes oldest video and retries the upload", async (t) => {
  const { env, log } = await evictionEnv(true);
  mockDrive(t, log, 1);
  const result = await putObjectWithFallback(env, "a", ["gdrive"], "a/new.mp4", new Uint8Array([1]), "video/mp4");
  assert.equal(result.backend, "gdrive");
  assert.deepEqual(log.expired, [1]);
  assert.equal(log.deleted.length, 1);
});

test("Drive full without autoEvict: nothing is deleted and the error surfaces", async (t) => {
  const { env, log } = await evictionEnv(false);
  mockDrive(t, log, 1);
  await assert.rejects(putObjectWithFallback(env, "a", ["gdrive"], "a/new.mp4", new Uint8Array([1]), "video/mp4"), /hết dung lượng/);
  assert.deepEqual(log.expired, []);
  assert.equal(log.deleted.length, 0);
});

test("auto-evict is on by default (setting absent) and only off when explicitly false", async (t) => {
  const { env, log } = await evictionEnv(undefined);
  mockDrive(t, log, 1);
  const result = await putObjectWithFallback(env, "a", ["gdrive"], "a/new.mp4", new Uint8Array([1]), "video/mp4");
  assert.equal(result.backend, "gdrive");
  assert.deepEqual(log.expired, [1]);
});

import { reclaimLowDriveSpace } from "../functions/_lib/storageGuard.js";

test("low-space guard evicts oldest clips until the Drive has headroom, then stops", async (t) => {
  const { env, log } = await evictionEnv(undefined);
  let remaining = 1000; // bytes free: below `low`
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const u = String(url);
    if (u.includes("oauth2")) return Response.json({ access_token: "tok" });
    if (u.includes("/about")) return Response.json({ storageQuota: { limit: "10000", usage: String(10000 - remaining) } });
    if (init.method === "DELETE") { remaining += 400; log.deleted.push(u); return new Response(null, { status: 204 }); }
    if (u.includes("/files?")) return Response.json({ files: [{ id: "f" }] });
    throw new Error(`Unexpected fetch: ${u}`);
  });
  const result = await reclaimLowDriveSpace(env, "a", { low: 1500, target: 1800 });
  assert.equal(result.length, 1);
  assert.deepEqual(log.expired, [1, 2]); // 1000 -> 1400 (still < 1800) -> 1800, then stops
  assert.equal(result[0].remainingBytes, 1800);
});

test("low-space guard does nothing when the Drive has enough space or autoEvict is off", async (t) => {
  for (const [auto, free] of [[undefined, 5000], [false, 100]]) {
    const { env, log } = await evictionEnv(auto);
    t.mock.method(globalThis, "fetch", async (url) => {
      const u = String(url);
      if (u.includes("oauth2")) return Response.json({ access_token: "tok" });
      if (u.includes("/about")) return Response.json({ storageQuota: { limit: "10000", usage: String(10000 - free) } });
      throw new Error(`Unexpected fetch: ${u}`);
    });
    assert.deepEqual(await reclaimLowDriveSpace(env, "a", { low: 1500, target: 1800 }), []);
    assert.deepEqual(log.expired, []);
    t.mock.restoreAll();
  }
});

import { reconcileDrive } from "../functions/_lib/storageReconcile.js";

test("reconcile reports linked/orphan/trashed bytes and missing DB references; apply cleans them", async (t) => {
  const env = { CUSTOMER_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"), GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" };
  const encrypted = await encryptConfig(env, { backend: "gdrive", gdrive: { refreshToken: "rt", folderId: "folder" } });
  const updates = [];
  const unsafe = async (sql, args) => {
    if (sql.includes("SELECT encrypted_config")) return [{ encrypted_config: encrypted }];
    if (sql.includes("FROM events")) return [{ id: 1, image_key: "a/1.jpg", video_key: "a/1.mp4" }, { id: 2, image_key: "a/2.jpg", video_key: "a/2.mp4" }];
    if (sql.includes("UPDATE events")) { updates.push(args[0]); return []; }
    throw new Error(sql);
  };
  env.DB_CLIENT = { unsafe, begin: async (fn) => Promise.all(fn({ unsafe })) };
  const deleted = [];
  const file = (id, name, size, key, trashed, created = "2020-01-01T00:00:00Z") => ({ id, name, size: String(size), createdTime: created, mimeType: name.endsWith("mp4") ? "video/mp4" : "image/jpeg", appProperties: key ? { cameraaiObjectKey: key } : undefined, _t: trashed });
  const live = [file("f1", "1.mp4", 100, "a/1.mp4"), file("f2", "1.jpg", 10, "a/1.jpg"), file("f3", "9.mp4", 500, "a/9.mp4"), file("f4", "x.txt", 5, null), file("f6", "10.mp4", 50, "a/10.mp4", false, new Date().toISOString())];
  const trash = [file("f5", "8.mp4", 700, "a/8.mp4")];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const u = String(url);
    if (u.includes("oauth2")) return Response.json({ access_token: "tok" });
    if (init.method === "DELETE") { deleted.push(u.split("/files/")[1].split("?")[0]); return new Response(null, { status: 204 }); }
    if (u.includes("/files?")) return Response.json({ files: decodeURIComponent(u.replace(/\+/g, " ")).includes("trashed = true") ? trash : live });
    throw new Error(u);
  });
  const report = await reconcileDrive(env, "a", "gdrive");
  assert.equal(report.linked.bytes, 110);
  assert.equal(report.orphan.video.bytes, 550); // includes the brand-new file, which is reported but never deleted
  assert.equal(report.trashed.bytes, 700);
  assert.equal(report.untagged, 1);
  assert.deepEqual(report.dbReferencesMissing, { video: 1, image: 1 }); // event 2 has neither file
  assert.deepEqual(deleted, []);
  const orphansOnly = await reconcileDrive(env, "a", "gdrive", { apply: true });
  assert.deepEqual(deleted.sort(), ["f3", "f5"]); // untagged f4, linked and brand-new f6 are never touched
  assert.equal(orphansOnly.clearedReferences, 0);
  assert.deepEqual(updates, []); // DB untouched unless clearReferences
  const full = await reconcileDrive(env, "a", "gdrive", { apply: true, clearReferences: true });
  assert.equal(full.clearedReferences, 2);
});
