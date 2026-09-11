import { getDb } from "../../../_lib/db.js";
import { errorJson, withErrorHandling } from "../../../_lib/http.js";
import { parseByteRange } from "../../../_lib/events.js";
import { getObject, headObject } from "../../../_lib/objectStorage.js";

// Streams the motion clip straight out of R2. Not a public R2/r2.dev URL —
// event footage is per-account data, so this goes through the same bearer
// API key auth as every other /api/* route (functions/_middleware.js)
// instead of relying on an unguessable object key.
export const onRequestGet = withErrorHandling(async ({ request, params, env, data }) => {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT video_key, storage_backend FROM events WHERE id = ? AND account_id = ?",
    args: [params.id, data.accountId],
  });

  const event = result.rows[0];
  if (!event || !event.video_key) return errorJson("Video not found", 404); // also true if it belongs to another account

  const backend = event.storage_backend || "r2";
  const head = await headObject(env, data.accountId, backend, event.video_key);
  if (!head) return errorJson("Video not found", 404);
  const range = parseByteRange(request.headers.get("Range"), head.size);
  if (range?.invalid) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head.size}`, "Accept-Ranges": "bytes" } });
  const object = await getObject(env, data.accountId, backend, event.video_key, range);
  if (!object) return errorJson("Video not found", 404);

  return new Response(object.body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": object.contentType || "video/mp4",
      "Content-Length": String(range?.length || head.size),
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${head.size}` } : {}),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
