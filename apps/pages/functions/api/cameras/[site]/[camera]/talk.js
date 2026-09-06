import { getSite, getCamera } from "../../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, params, env, data }) => {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const type = request.headers.get("content-type") || "";
  if (!type.startsWith("audio/")) return errorJson("Yêu cầu phải chứa audio", 415);
  const audio = await request.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > 3 * 1024 * 1024) return errorJson("Audio trống hoặc lớn hơn 3 MB", 413);
  const response = await fetch(`${site.relay_url}/talk/${camera.stream}`, {
    method: "POST",
    headers: { "content-type": type, "x-relay-secret": site.relay_secret },
    body: audio,
  });
  if (!response.ok) return errorJson(response.status === 409 ? "Camera không hỗ trợ đàm thoại" : "Không phát được âm thanh", response.status === 409 ? 409 : 502);
  return json({ ok: true });
});
