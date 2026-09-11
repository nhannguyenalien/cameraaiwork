import { getSite, getCamera } from "../../../../_lib/sites.js";
import { errorJson, withErrorHandling } from "../../../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const site = await getSite(env, data.accountId, params.site);
  if (!site) return errorJson("Site not found", 404);
  if (!site.relay_url) {
    return new Response(JSON.stringify({ error: "Máy relay của site chưa được cấu hình", code: "relay_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  let response;
  try {
    // Some low-cost RTSP cameras need a couple of attempts while go2rtc
    // starts a producer after it has been idle. Keep this retry at the edge so
    // a transient warm-up failure does not mark a powered camera as offline.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await fetch(
        `${site.relay_url.replace(/\/$/, "")}/internal/frame.jpeg?src=${encodeURIComponent(camera.stream)}&_=${Date.now()}-${attempt}`,
        {
          headers: {
            "x-relay-secret": site.relay_secret,
            "Cache-Control": "no-cache, no-store",
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.ok || attempt === 3 || ![502, 503, 504].includes(response.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return new Response(JSON.stringify({
      error: timedOut ? "Máy relay không phản hồi kịp" : "Không kết nối được máy relay",
      code: timedOut ? "relay_timeout" : "relay_unreachable",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const code = detail.code || (response.status === 401 ? "relay_auth_error" : response.status === 404 ? "camera_not_configured" : "camera_unreachable");
    const messages = {
      relay_auth_error: "Relay từ chối xác thực",
      camera_not_configured: "Camera không có trong cấu hình relay",
      go2rtc_unavailable: "Dịch vụ video go2rtc đang lỗi",
      camera_unreachable: "Camera đang tắt hoặc mất kết nối mạng/RTSP",
    };
    return new Response(JSON.stringify({ error: detail.error || messages[code] || "Không lấy được ảnh camera", code }), {
      status: response.status === 401 ? 502 : 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jpeg = await response.arrayBuffer();
  const bytes = new Uint8Array(jpeg);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return new Response(JSON.stringify({ error: "Camera trả về ảnh không hợp lệ", code: "invalid_snapshot" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(jpeg, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store, no-cache, max-age=0",
      Pragma: "no-cache",
    },
  });
});
