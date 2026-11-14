import { getDb } from "../../../_lib/db.js";
import { errorJson, withErrorHandling } from "../../../_lib/http.js";
import { parseByteRange } from "../../../_lib/events.js";
import { getObject, headObject } from "../../../_lib/objectStorage.js";

export const onRequestGet = withErrorHandling(async ({ request, params, env, data }) => {
  const result = await getDb(env, "api.daily-summaries.video").execute({
    sql: "SELECT video_key, storage_backend FROM daily_summaries WHERE id = ? AND account_id = ? AND status = 'ready'",
    args: [params.id, data.accountId],
  });
  const row = result.rows[0];
  if (!row?.video_key) return errorJson("Video not found", 404);
  const backend = row.storage_backend || "r2";
  const head = await headObject(env, data.accountId, backend, row.video_key);
  if (!head) return errorJson("Video not found", 404);
  const range = parseByteRange(request.headers.get("Range"), head.size);
  if (range?.invalid) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head.size}` } });
  const object = await getObject(env, data.accountId, backend, row.video_key, range);
  if (!object) return errorJson("Video not found", 404);
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": "video/mp4", "Content-Length": String(range?.length || head.size), "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${head.size}` } : {}),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
