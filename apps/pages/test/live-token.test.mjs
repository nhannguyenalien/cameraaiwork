import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { liveTokenPayload, signLiveToken } from "../functions/_lib/liveToken.js";

test("Pages signs the exact token format verified by the on-site relay", async () => {
  const secret = "relay-secret-for-test";
  const site = "st-demo";
  const camera = "front-door";
  const expiresAt = 2_000_000_300;
  const viewerLimit = 5;
  const nonce = "lv-testnonce";
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(liveTokenPayload(site, camera, expiresAt, viewerLimit, nonce))
    .digest("base64url");

  assert.equal(
    await signLiveToken(secret, site, camera, expiresAt, viewerLimit, nonce),
    `v2.${expiresAt}.${viewerLimit}.${nonce}.${expectedSignature}`
  );
});
