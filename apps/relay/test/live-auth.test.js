const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { livePayload, verifyLiveToken, parseLiveRequest } = require("../src/live-auth");

const options = {
  siteId: "st-demo",
  relaySecret: "relay-secret-for-test",
  cameras: [{ stream: "front-door" }, { stream: "yard" }],
  now: 2_000_000_000,
};

function token(camera, expiresAt = options.now + 300, viewerLimit = 1, nonce = "lv-testnonce") {
  const signature = crypto
    .createHmac("sha256", options.relaySecret)
    .update(livePayload(options.siteId, camera, expiresAt, viewerLimit, nonce))
    .digest("base64url");
  return `v2.${expiresAt}.${viewerLimit}.${nonce}.${signature}`;
}

test("accepts a valid camera-scoped token", () => {
  assert.equal(verifyLiveToken({ ...options, token: token("front-door"), camera: "front-door" }), true);
});

test("rejects expired, overlong, tampered and cross-camera tokens", () => {
  assert.equal(verifyLiveToken({ ...options, token: token("front-door", options.now - 1), camera: "front-door" }), false);
  assert.equal(verifyLiveToken({ ...options, token: token("front-door", options.now + 601), camera: "front-door" }), false);
  assert.equal(verifyLiveToken({ ...options, token: `${token("front-door")}x`, camera: "front-door" }), false);
  assert.equal(verifyLiveToken({ ...options, token: token("front-door"), camera: "yard" }), false);
});

test("preserves token prefix for static assets and strips it before proxying", () => {
  const signed = token("front-door");
  assert.deepEqual(parseLiveRequest(`/live/${signed}/video-stream.js`, options), {
    path: "/video-stream.js",
    camera: "front-door",
    viewerLimit: 1,
    nonce: "lv-testnonce",
  });
});

test("allows WebRTC signaling only for an explicitly signed camera", () => {
  const signed = token("front-door");
  assert.deepEqual(parseLiveRequest(`/live/${signed}/api/ws?src=front-door`, options), {
    path: "/api/ws?src=front-door",
    camera: "front-door",
    viewerLimit: 1,
    nonce: "lv-testnonce",
  });
  assert.equal(parseLiveRequest(`/live/${signed}/api/ws?src=yard`, options), null);
  assert.equal(parseLiveRequest(`/live/${signed}/api/config`, options), null);
});

test("viewer limit is signed and cannot be upgraded by editing the URL", () => {
  const signed = token("front-door", options.now + 300, 5);
  assert.equal(verifyLiveToken({ ...options, token: signed, camera: "front-door" }), true);
  assert.equal(verifyLiveToken({ ...options, token: signed.replace(".5.", ".6."), camera: "front-door" }), false);
});
