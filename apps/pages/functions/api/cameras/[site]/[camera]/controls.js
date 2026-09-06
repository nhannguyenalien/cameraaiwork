import { getSite, getCamera } from "../../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

async function resolveCamera(env, data, params) {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return { error: errorJson("Site not found", 404) };
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return { error: errorJson("Camera not found", 404) };
  return { site, camera };
}

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const found = await resolveCamera(env, data, params);
  if (found.error) return found.error;
  const response = await fetch(`${found.site.relay_url}/controls/${found.camera.stream}`, {
    headers: { "x-relay-secret": found.site.relay_secret },
  });
  if (!response.ok) return errorJson("Relay unreachable", 502);
  return json(await response.json());
});

export const onRequestPost = withErrorHandling(async ({ request, params, env, data }) => {
  const found = await resolveCamera(env, data, params);
  if (found.error) return found.error;
  const body = await request.json();
  if (typeof body?.light !== "boolean") return errorJson("light phải là boolean", 400);
  const response = await fetch(`${found.site.relay_url}/light/${found.camera.stream}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-secret": found.site.relay_secret },
    body: JSON.stringify({ enabled: body.light }),
  });
  if (!response.ok) return errorJson(response.status === 409 ? "Camera không hỗ trợ điều khiển đèn" : "Relay unreachable", response.status === 409 ? 409 : 502);
  return json({ ok: true });
});
