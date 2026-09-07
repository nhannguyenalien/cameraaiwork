import { getSite } from "../../../_lib/sites.js";
import { json, errorJson, withErrorHandling } from "../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.id);
  if (!site) return errorJson("Site not found", 404);
  if (!site.relay_url) return errorJson("Máy site chưa online", 409);
  const response = await fetch(`${site.relay_url}/discover/cameras`, {
    method: "POST",
    headers: { "x-relay-secret": site.relay_secret },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return errorJson(result.error || "Không quét được mạng LAN tại site", 502);
  return json(result);
});
