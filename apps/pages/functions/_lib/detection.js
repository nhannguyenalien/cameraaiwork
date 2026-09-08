// Extension point: if AI_WORKER_URL is set (tunneled Python service
// on-site, see ai/worker/), ask it whether the frame has a person — and
// if so, its face embedding for clustering "who is this" (see
// _lib/faceMatch.js). Unset AI_WORKER_URL -> every motion event alerts
// with no face data (safe default, matches original behavior).
export async function detectPerson(env, site, frameBuffer) {
  const workerUrls = detectionWorkerUrls(env, site);
  if (workerUrls.length === 0) {
    return { hasPerson: true, faceEmbedding: null, faceEmbeddings: [] };
  }

  const failures = [];
  for (const workerUrl of workerUrls) {
    try {
      const res = await fetch(`${workerUrl}/detect`, {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "x-relay-secret": site.relay_secret,
        },
        body: frameBuffer,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const faceEmbeddings = Array.isArray(data.faceEmbeddings)
        ? data.faceEmbeddings
            .map((face) => Array.isArray(face) ? face : face?.embedding)
            .filter(Array.isArray)
        : [];
      const faceEmbedding = Array.isArray(data.faceEmbedding) ? data.faceEmbedding : faceEmbeddings[0] || null;
      return {
        hasPerson: Boolean(data.hasPerson),
        faceEmbedding,
        faceEmbeddings: faceEmbeddings.length ? faceEmbeddings : (faceEmbedding ? [faceEmbedding] : []),
      };
    } catch (e) {
      failures.push(`${workerUrl}: ${e.message}`);
    }
  }

  // Never turn an unavailable/invalid AI response into a person event. That
  // fail-open behavior created empty clips with personId=null whenever a
  // transient go2rtc snapshot was not a valid JPEG.
  console.warn("AI worker không xác nhận được người, bỏ qua event:", failures.join("; "));
  return { hasPerson: false, faceEmbedding: null, faceEmbeddings: [] };
}

export function detectionWorkerUrls(env, site) {
  const urls = [site.ai_worker_url || env.AI_WORKER_URL];
  if (site.relay_url) urls.push(`${site.relay_url.replace(/\/$/, "")}/internal/ai`);
  return [...new Set(urls.filter(Boolean).map((url) => url.replace(/\/$/, "")))];
}
