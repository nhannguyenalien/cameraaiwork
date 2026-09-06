import { getDb } from "../../../_lib/db.js";
import { errorJson, withErrorHandling } from "../../../_lib/http.js";

// Streams the motion clip straight out of R2. Not a public R2/r2.dev URL —
// event footage is per-account data, so this goes through the same bearer
// API key auth as every other /api/* route (functions/_middleware.js)
// instead of relying on an unguessable object key.
export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT video_key FROM events WHERE id = ? AND account_id = ?",
    args: [params.id, data.accountId],
  });

  const event = result.rows[0];
  if (!event || !event.video_key) return errorJson("Video not found", 404); // also true if it belongs to another account

  const object = await env.EVENTS_BUCKET.get(event.video_key);
  if (!object) return errorJson("Video not found", 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "video/mp4",
      "Content-Length": String(object.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
