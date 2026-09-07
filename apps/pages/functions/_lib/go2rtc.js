// go2rtc's real snapshot endpoint is /api/frame.jpeg (not .jpg — caught via
// live testing, see docs/PLAN.md). It shells out to ffmpeg internally, so
// this fails if ffmpeg isn't installed/working on the on-site machine.
export async function getFrame(env, site, camera) {
  // A unique URL is required here: Cloudflare may otherwise reuse the JPEG
  // returned for an earlier detection because the frame endpoint is public.
  const nonce = `${Date.now()}-${crypto.randomUUID()}`;
  const res = await fetch(`${site.relay_url}/internal/frame.jpeg?src=${encodeURIComponent(camera)}&_=${nonce}`, {
    headers: {
      "x-relay-secret": site.relay_secret,
      "Cache-Control": "no-cache, no-store",
    },
  });
  if (!res.ok) throw new Error(`go2rtc frame lỗi: ${res.status}`);
  const frame = await res.arrayBuffer();
  const bytes = new Uint8Array(frame);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("go2rtc frame không phải JPEG hợp lệ");
  }
  return frame;
}

// NOTE: go2rtc has no "export N seconds as a file" endpoint — /api/stream.mp4
// is a live progressive stream, not a bounded clip (also caught via live
// testing; the original design here assumed an endpoint that doesn't
// exist). Alerts use a snapshot instead for now — see getFrame above and
// docs/PLAN.md's backlog for the real clip-capture approach.
