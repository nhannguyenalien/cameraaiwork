// Extension point: if AI_WORKER_URL is set (tunneled Python service
// on-site, see ai/worker/), ask it whether the frame has a person — and
// if so, its face embedding for clustering "who is this" (see
// _lib/faceMatch.js). Unset AI_WORKER_URL -> every motion event alerts
// with no face data (safe default, matches original behavior).
export async function detectPerson(env, frameBuffer) {
  if (!env.AI_WORKER_URL) {
    return { hasPerson: true, faceEmbedding: null };
  }

  try {
    const res = await fetch(env.AI_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: frameBuffer,
    });
    const data = await res.json();
    return {
      hasPerson: Boolean(data.hasPerson),
      faceEmbedding: Array.isArray(data.faceEmbedding) ? data.faceEmbedding : null,
    };
  } catch (e) {
    console.warn("AI worker không phản hồi, coi như có báo động:", e.message);
    return { hasPerson: true, faceEmbedding: null };
  }
}
