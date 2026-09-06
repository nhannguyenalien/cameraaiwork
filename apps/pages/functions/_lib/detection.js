// Extension point: if AI_WORKER_URL is set (tunneled Python service
// on-site, see ai/worker/), ask it whether the frame has a person — and
// if so, its face embedding for clustering "who is this" (see
// _lib/faceMatch.js). Unset AI_WORKER_URL -> every motion event alerts
// with no face data (safe default, matches original behavior).
export async function detectPerson(env, site, frameBuffer) {
  const workerUrl = site.ai_worker_url || env.AI_WORKER_URL;
  if (!workerUrl) {
    return { hasPerson: true, faceEmbedding: null };
  }

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/detect`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "x-relay-secret": site.relay_secret,
      },
      body: frameBuffer,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      hasPerson: Boolean(data.hasPerson),
      faceEmbedding: Array.isArray(data.faceEmbedding) ? data.faceEmbedding : null,
    };
  } catch (e) {
    // Never turn an unavailable/invalid AI response into a person event. That
    // fail-open behavior created empty clips with personId=null whenever a
    // transient go2rtc snapshot was not a valid JPEG.
    console.warn("AI worker không xác nhận được người, bỏ qua event:", e.message);
    return { hasPerson: false, faceEmbedding: null };
  }
}
