// POST /api/sites/:id/update — dashboard "Đẩy update tới site này" button.
// Admin-triggered (the human checkpoint update.sh's own comments call for),
// but no SSH: this just asks the relay to run its own local update.sh.
// GET does the same route's status poll, since the relay may restart mid-update.
import { getSite } from "../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);
  if (!site.relay_url) return errorJson("Máy site chưa online", 409);
  const response = await fetch(`${site.relay_url}/update`, {
    method: "POST",
    headers: { "x-relay-secret": site.relay_secret },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return errorJson(result.error || "Không kích hoạt được cập nhật tại site", response.status === 409 ? 409 : 502);
  return json(result);
});

export const onRequestGet = withErrorHandling(async ({ request, params, env, data }) => {
  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);
  // Static asset on this same Pages deployment — reflects whatever bundle
  // scripts/build-relay-bundle.sh most recently produced, independent of
  // any particular site's relay being reachable.
  const latestVersion = await fetch(new URL("/cameraaiwork-relay-version.json", request.url))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!site.relay_url) return json({ status: "unknown", latestVersion });
  try {
    const response = await fetch(`${site.relay_url}/update/status`, {
      headers: { "x-relay-secret": site.relay_secret },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ status: "unknown", latestVersion });
    return json({ ...result, latestVersion });
  } catch {
    // Relay can be briefly unreachable mid-restart — not an error the
    // dashboard poll should surface, just "still going".
    return json({ status: "unreachable", latestVersion });
  }
});
