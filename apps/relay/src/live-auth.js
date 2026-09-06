const crypto = require("crypto");

const MAX_FUTURE_SECONDS = 10 * 60;

function livePayload(siteId, camera, expiresAt, viewerLimit, nonce) {
  return `v2\n${siteId}\n${camera}\n${expiresAt}\n${viewerLimit}\n${nonce}`;
}

function tokenClaims({ token, camera, siteId, relaySecret, cameras, now = Math.floor(Date.now() / 1000) }) {
  if (!relaySecret || !camera || !cameras.some((item) => item.stream === camera)) return false;
  const match = /^v2\.(\d+)\.(\d+)\.([A-Za-z0-9_-]{3,80})\.([A-Za-z0-9_-]{43})$/.exec(token || "");
  if (!match) return false;

  const expiresAt = Number(match[1]);
  const viewerLimit = Number(match[2]);
  const nonce = match[3];
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + MAX_FUTURE_SECONDS) return false;
  if (!Number.isSafeInteger(viewerLimit) || viewerLimit < 1 || viewerLimit > 100) return false;

  const expected = crypto
    .createHmac("sha256", relaySecret)
    .update(livePayload(siteId, camera, expiresAt, viewerLimit, nonce))
    .digest("base64url");
  const actualBuffer = Buffer.from(match[4]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  return { expiresAt, viewerLimit, nonce };
}

function verifyLiveToken(options) {
  return Boolean(tokenClaims(options));
}

function tokenCamera(token, options) {
  for (const camera of options.cameras) {
    if (verifyLiveToken({ ...options, token, camera: camera.stream })) return camera.stream;
  }
  return "";
}

function isAllowedLivePath(pathname) {
  return pathname === "/stream.html" || pathname === "/api/ws" || /\.(?:js|css|svg|png|ico)$/.test(pathname);
}

function parseLiveRequest(rawUrl, options) {
  const url = new URL(rawUrl, "http://relay.local");
  const match = /^\/live\/([^/]+)(\/.*)$/.exec(url.pathname);
  if (!match || !isAllowedLivePath(match[2])) return null;

  const camera = url.searchParams.get("src") || tokenCamera(match[1], options);
  const claims = tokenClaims({ ...options, token: match[1], camera });
  if (!claims) return null;
  return { path: `${match[2]}${url.search}`, camera, viewerLimit: claims.viewerLimit, nonce: claims.nonce };
}

module.exports = { livePayload, tokenClaims, verifyLiveToken, parseLiveRequest };
