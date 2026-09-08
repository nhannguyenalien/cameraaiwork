import { getSite, getCamera } from "../../../../_lib/sites.js";
import { errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  const response = await fetch(
    `${site.relay_url.replace(/\/$/, "")}/internal/frame.jpeg?src=${encodeURIComponent(camera.stream)}&_=${Date.now()}`,
    {
      headers: {
        "x-relay-secret": site.relay_secret,
        "Cache-Control": "no-cache, no-store",
      },
    },
  );
  if (!response.ok) return errorJson("Camera offline", 502);

  const jpeg = await response.arrayBuffer();
  const bytes = new Uint8Array(jpeg);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return errorJson("Invalid camera snapshot", 502);
  }

  return new Response(jpeg, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store, no-cache, max-age=0",
      Pragma: "no-cache",
    },
  });
});
