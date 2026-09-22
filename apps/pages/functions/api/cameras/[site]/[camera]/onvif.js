import { getSite, getCamera } from "../../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ request, params, env, data }) => {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const refresh = new URL(request.url).searchParams.get("refresh") === "1" ? "?refresh=1" : "";
  const response = await fetch(`${site.relay_url}/onvif/${encodeURIComponent(camera.stream)}${refresh}`, {
    headers: { "x-relay-secret": site.relay_secret },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return errorJson(result.error || "Không đọc được cấu hình ONVIF", response.status === 409 ? 409 : 502);
  return json(result);
});
