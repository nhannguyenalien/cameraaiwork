// POST /api/cameras/:site/:camera/ptz  { "direction": "up"|"down"|"left"|"right"|"stop" }
// Forwards to that site's relay — Pages Functions have no route into a
// camera's LAN themselves, ONVIF has to happen from a machine on-site.
import { getSite, getCamera } from "../../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

const ALLOWED = ["up", "down", "left", "right", "stop"];

export const onRequestPost = withErrorHandling(async ({ request, params, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const { direction } = body;
  if (!ALLOWED.includes(direction)) {
    return errorJson(`direction phải là một trong: ${ALLOWED.join(", ")}`, 400);
  }

  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  const res = await fetch(`${site.relay_url}/ptz/${camera.stream}/${direction}`, {
    method: "POST",
    headers: { "x-relay-secret": site.relay_secret },
  });

  if (!res.ok) return errorJson("Relay unreachable", 502);
  return json({ ok: true });
});
