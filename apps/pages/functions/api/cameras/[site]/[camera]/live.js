// POST /api/cameras/:site/:camera/live
// The SaaS session/API key authorizes the account. A short-lived HMAC token
// then authorizes only one camera at the site's relay; no customer needs a
// Cloudflare Access identity.
import { getSite, getCamera } from "../../../../_lib/sites.js";
import { signLiveToken } from "../../../../_lib/liveToken.js";
import { accountUsage } from "../../../../_lib/plans.js";
import { randomId } from "../../../../_lib/ids.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

const LIVE_TOKEN_TTL_SECONDS = 5 * 60;

export const onRequestPost = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  const summary = await accountUsage(env, data.accountId);
  const viewerLimit = summary.limits.viewersPerCamera;
  const expiresAt = Math.floor(Date.now() / 1000) + LIVE_TOKEN_TTL_SECONDS;
  const nonce = randomId("lv");
  const token = await signLiveToken(site.relay_secret, site.id, camera.stream, expiresAt, viewerLimit, nonce);
  const base = site.relay_url.replace(/\/$/, "");
  // WebRTC advertises the relay's LAN/UDP candidates (for example
  // 192.168.x.x:8555), which are unreachable for viewers on another
  // network. MSE carries the video over the already-authenticated WebSocket
  // endpoint, so both signalling and media stay inside the HTTPS tunnel.
  const url = `${base}/live/${token}/stream.html?src=${encodeURIComponent(camera.stream)}&mode=mse`;

  return json({ url, expiresAt, viewerLimit });
});
