import { getDb } from "../../../_lib/db.js";
import { errorJson, withErrorHandling } from "../../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT image_key FROM events WHERE id = ? AND account_id = ?",
    args: [params.id, data.accountId],
  });
  const event = result.rows[0];
  if (!event?.image_key) return errorJson("Image not found", 404);

  const object = await env.EVENTS_BUCKET.get(event.image_key);
  if (!object) return errorJson("Image not found", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
      "Content-Length": String(object.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
