import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT * FROM jobs WHERE id = ? AND account_id = ?",
    args: [params.id, data.accountId],
  });

  const job = result.rows[0];
  if (!job) return errorJson("Job not found", 404); // also true if it belongs to another account

  if (job.id.startsWith("runpod-")) {
    const runpodId = job.id.replace("runpod-", "");
    const res = await fetch(
      `https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/status/${runpodId}`,
      { headers: { Authorization: `Bearer ${env.RUNPOD_API_KEY}` } }
    );
    const statusData = await res.json();
    return json({ id: job.id, type: job.type, ...statusData });
  }

  return json(job);
});
