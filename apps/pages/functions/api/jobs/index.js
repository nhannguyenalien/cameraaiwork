// POST /api/jobs  { "type": "runpod", "task": "face_search", ...extra }
// Fire-and-forget dispatch of a heavy GPU job. Job id is namespaced by
// provider ("runpod-<id>", "-" not ":" — see the note in schema.sql about
// colons breaking Cloudflare Pages Functions' router) so a second provider
// can be added later without changing the response shape. Tracked
// per-account in the `jobs` table so GET /api/jobs/:id can't leak another
// tenant's job.
import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const { type, task, ...rest } = body;
  if (type !== "runpod") {
    return errorJson(`Unsupported job type: ${type}`, 400);
  }
  if (!env.RUNPOD_API_KEY || !env.RUNPOD_ENDPOINT_ID) {
    return errorJson("RunPod chưa được cấu hình", 503);
  }

  const res = await fetch(`https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: { task, ...rest } }),
  });

  if (!res.ok) return errorJson("RunPod submit thất bại", 502);
  const runpodData = await res.json();
  const jobId = `runpod-${runpodData.id}`;

  const db = getDb(env);
  await db.execute({
    sql: "INSERT INTO jobs (id, account_id, type) VALUES (?, ?, ?)",
    args: [jobId, data.accountId, task || null],
  });

  return json({ id: jobId, status: "queued" }, { status: 202 });
});
