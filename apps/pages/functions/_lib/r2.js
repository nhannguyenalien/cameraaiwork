// go2rtc has no "export N seconds as a file" endpoint — /api/stream.mp4 is
// a live progressive MP4 that keeps streaming until the client disconnects
// (see docs/PLAN.md). To turn that into a bounded clip we read it
// ourselves and stop after CLIP_SECONDS, then upload the bounded buffer.
//
// ASSUMPTION, not yet verified against a real camera: go2rtc's progressive
// MP4 output must be fragmented (moov/moof per chunk, not one trailing
// moov atom) for a browser to play it live at all — if so, truncating
// mid-stream still yields a playable file up to the last full fragment.
// Verify this against a real go2rtc instance before relying on it; if
// clips come out unplayable, that assumption is the first thing to check.
const CLIP_SECONDS = 10;
const MAX_CLIP_BYTES = 20 * 1024 * 1024; // safety net if bitrate is far above expected

async function readBoundedClip(readableBody, maxMs, maxBytes) {
  const reader = readableBody.getReader();
  const chunks = [];
  let bytesRead = 0;
  const deadline = Date.now() + maxMs;
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), maxMs));

  try {
    while (bytesRead < maxBytes && Date.now() < deadline) {
      // A timer can be starved when the stream always has another chunk ready
      // and each read resumes in the microtask queue. The absolute deadline
      // above guarantees termination even in that case; the race also handles
      // a stream that stalls with no next chunk.
      const result = await Promise.race([reader.read(), timeout]);
      if (result.timeout || result.done || Date.now() >= deadline) break;
      const remaining = maxBytes - bytesRead;
      const chunk = result.value.byteLength > remaining ? result.value.slice(0, remaining) : result.value;
      chunks.push(chunk);
      bytesRead += chunk.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const clip = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    clip.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return clip;
}

// Start reading the live stream immediately when the motion webhook arrives.
// In particular, do not wait for snapshot AI, Telegram and the DB insert: on a
// person walking through frame those steps used to delay the clip by 1-2s and
// the evidence could be gone before recording began.
export async function captureClip(site, camera) {
  try {
    const clipUrl = `${site.relay_url}/internal/clip.mp4?src=${encodeURIComponent(camera)}`;
    const res = await fetch(clipUrl, {
      redirect: "manual",
      headers: { "x-relay-secret": site.relay_secret },
    });
    if (!res.ok || !res.body) throw new Error(`go2rtc stream lỗi: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("video/mp4")) {
      throw new Error(`go2rtc trả content-type không hợp lệ: ${contentType || "unknown"}`);
    }

    const clip = await readBoundedClip(res.body, CLIP_SECONDS * 1000, MAX_CLIP_BYTES);
    if (!clip.byteLength) throw new Error("go2rtc trả clip rỗng");

    return clip;
  } catch (err) {
    console.error(`Capture clip thất bại (${site.id}/${camera}):`, err.message || err);
    return null;
  }
}

// Upload is deliberately separate from capture so motion.js can begin capture
// before it knows the eventual DB event id / R2 key.
export async function uploadClip(env, clipPromise, key) {
  if (!env.EVENTS_BUCKET) {
    throw new Error("Kho R2 chưa được cấu hình");
  }

  const clip = await clipPromise;
  if (!clip?.byteLength) throw new Error("Camera không trả về clip hợp lệ");
  await env.EVENTS_BUCKET.put(key, clip, {
    httpMetadata: { contentType: "video/mp4" },
  });
  return key;
}

export async function uploadSnapshot(env, frame, key) {
  if (!env.EVENTS_BUCKET) throw new Error("Kho R2 chưa được cấu hình");
  if (!frame?.byteLength) throw new Error("Ảnh camera rỗng");
  await env.EVENTS_BUCKET.put(key, frame, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return key;
}
