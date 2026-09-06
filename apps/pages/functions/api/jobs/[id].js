import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { getIntegration } from "../../_lib/integrations.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT * FROM jobs WHERE id = ? AND account_id = ?",
    args: [params.id, data.accountId],
  });

  const job = result.rows[0];
  if (!job) return errorJson("Job not found", 404); // also true if it belongs to another account

  if (job.id.startsWith("runpod-")) {
    const runpod = await getIntegration(env, data.accountId, "runpod");
    if (!runpod?.apiKey || !runpod?.endpointId) return errorJson("RunPod chưa được cấu hình", 503);
    const runpodId = job.id.replace("runpod-", "");
    const res = await fetch(
      `https://api.runpod.ai/v2/${runpod.endpointId}/status/${runpodId}`,
      { headers: { Authorization: `Bearer ${runpod.apiKey}` } }
    );
    const statusData = await res.json();
    return json({ id: job.id, type: job.type, ...statusData });
  }

  return json(job);
});
