// Extension point: if AI_WORKER_URL is set (tunneled Python service on the
// Mac mini, see ai/worker/), ask it whether the frame has a person. Unset
// -> every motion event alerts (safe default, matches original behavior).
export async function hasPerson(env, frameBuffer) {
  if (!env.AI_WORKER_URL) return true;

  try {
    const res = await fetch(env.AI_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: frameBuffer,
    });
    const data = await res.json();
    return Boolean(data.hasPerson);
  } catch (e) {
    console.warn("AI worker không phản hồi, coi như có báo động:", e.message);
    return true;
  }
}
