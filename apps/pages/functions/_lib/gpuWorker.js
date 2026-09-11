export async function triggerGpuScan(env, eventId = null) {
  if (!env.GPU_WORKER_URL || !env.GPU_WORKER_TOKEN) return false;
  const response = await fetch(env.GPU_WORKER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GPU_WORKER_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventId ? { eventId } : {}),
  });
  if (!response.ok) throw new Error(`GPU worker HTTP ${response.status}`);
  return true;
}
