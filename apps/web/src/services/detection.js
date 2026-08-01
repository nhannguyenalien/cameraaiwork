const axios = require("axios");
const config = require("../config");

// Extension point: if AI_WORKER_URL is set, ask the local Python AI worker
// (ai/worker) whether the motion frame actually contains a person. If it's
// unreachable or unset, fall back to treating every motion as an alert —
// this is intentional so the system keeps working before the AI worker
// exists or while it's down.
async function hasPerson(frameBuffer) {
  const { url, timeoutMs } = config.aiWorker;
  if (!url) return true;

  try {
    const res = await axios.post(url, frameBuffer, {
      headers: { "Content-Type": "image/jpeg" },
      timeout: timeoutMs,
    });
    return Boolean(res.data?.hasPerson);
  } catch (e) {
    console.warn("⚠️ AI worker không phản hồi, coi như có báo động:", e.message);
    return true;
  }
}

module.exports = { hasPerson };
