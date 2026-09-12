import { getCamera, getSite } from "../../../../_lib/sites.js";
import { errorJson, json, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const started = Date.now();
  if (!site.relay_url) {
    return json({ cameraId: camera.id, siteId: site.id, status: "relay_not_configured", relayOnline: false, cameraOnline: false, message: "Site chưa cấu hình máy relay", checkedAt: new Date().toISOString() }, { status: 503 });
  }
  try {
    const response = await fetch(`${site.relay_url.replace(/\/$/, "")}/controls/${encodeURIComponent(camera.stream)}`, {
      headers: { "x-relay-secret": site.relay_secret },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const status = response.status === 401 ? "relay_auth_error" : response.status === 404 ? "camera_not_configured" : "relay_error";
      return json({ cameraId: camera.id, siteId: site.id, status, relayOnline: true, cameraOnline: false, message: status === "relay_auth_error" ? "Relay từ chối xác thực" : status === "camera_not_configured" ? "Camera không có trong cấu hình relay" : `Relay trả về HTTP ${response.status}`, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() }, { status: 503 });
    }
    const controls = await response.json();
    const cameraOnline = Boolean(controls.online);
    return json({ cameraId: camera.id, siteId: site.id, status: cameraOnline ? "online" : "camera_unreachable", relayOnline: true, cameraOnline, message: cameraOnline ? "Camera và relay hoạt động bình thường" : "Camera đang tắt, mất mạng hoặc RTSP/ONVIF không kết nối được", latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), controls });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return json({ cameraId: camera.id, siteId: site.id, status: timedOut ? "relay_timeout" : "relay_unreachable", relayOnline: false, cameraOnline: false, message: timedOut ? "Máy relay phản hồi quá chậm" : "Máy relay hoặc Cloudflare Tunnel đang offline", latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), controls: { online: false, ptz: false, talk: false, light: false } }, { status: 503 });
  }
});
