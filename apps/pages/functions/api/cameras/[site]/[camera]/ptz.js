// POST /api/cameras/:site/:camera/ptz  { "direction": "up"|"down"|"left"|"right"|"stop" }
// Forwards to that site's relay — Pages Functions have no route into a
// camera's LAN themselves, ONVIF has to happen from a machine on-site.
import { getSite, getCamera } from "../../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

const ALLOWED = ["up", "down", "left", "right", "stop", "zoomIn", "zoomOut", "home", "gotoPreset", "setPreset"];

export const onRequestPost = withErrorHandling(async ({ request, params, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const action = body.action || body.direction;
  if (!ALLOWED.includes(action)) return errorJson(`action phải là một trong: ${ALLOWED.join(", ")}`, 400);
  if (body.speed !== undefined && (!Number.isFinite(Number(body.speed)) || Number(body.speed) < 0.1 || Number(body.speed) > 1)) return errorJson("speed phải từ 0.1 đến 1", 400);
  if (body.durationMs !== undefined && (!Number.isInteger(Number(body.durationMs)) || Number(body.durationMs) < 100 || Number(body.durationMs) > 5000)) return errorJson("durationMs phải từ 100 đến 5000", 400);

  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  const res = await fetch(`${site.relay_url.replace(/\/$/, "")}/ptz/${encodeURIComponent(camera.stream)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-secret": site.relay_secret },
    body: JSON.stringify({ ...body, action }),
  });

  if (!res.ok) return errorJson(res.status === 409 ? "Camera không hỗ trợ lệnh PTZ hoặc đang offline" : "Relay unreachable", res.status === 409 ? 409 : 502);
  return json(await res.json().catch(() => ({ ok: true })));
});
