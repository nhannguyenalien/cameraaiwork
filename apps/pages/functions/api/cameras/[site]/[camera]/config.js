import { getSite, getCamera } from "../../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

async function resolve(env, data, params) {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return { error: errorJson("Site not found", 404) };
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return { error: errorJson("Camera not found", 404) };
  return { site, camera };
}

async function relayError(response) {
  const result = await response.json().catch(() => ({}));
  return errorJson(result.error || "Không kết nối được máy tại site", response.status >= 500 ? 502 : response.status);
}

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const found = await resolve(env, data, params);
  if (found.error) return found.error;
  const response = await fetch(`${found.site.relay_url}/config/cameras/${encodeURIComponent(found.camera.stream)}`, {
    headers: { "x-relay-secret": found.site.relay_secret },
  });
  if (!response.ok) return relayError(response);
  return json(await response.json());
});

export const onRequestPut = withErrorHandling(async ({ request, params, env, data }) => {
  const found = await resolve(env, data, params);
  if (found.error) return found.error;
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body", 400);
  const response = await fetch(`${found.site.relay_url}/config/cameras/${encodeURIComponent(found.camera.stream)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-relay-secret": found.site.relay_secret },
    body: JSON.stringify(body),
  });
  if (!response.ok) return relayError(response);
  return json(await response.json());
});
