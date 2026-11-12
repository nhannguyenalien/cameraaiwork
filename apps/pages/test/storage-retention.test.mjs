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
  const encrypted = await encryptConfig(env, { backend: "gdrive", gdrive: { refreshToken: "rt", folderId: "folder" }, autoEvict });
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
