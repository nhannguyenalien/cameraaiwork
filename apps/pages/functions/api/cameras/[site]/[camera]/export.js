import { getCamera } from "../../../../_lib/sites.js";
import { getDb } from "../../../../_lib/db.js";
import { errorJson, withErrorHandling } from "../../../../_lib/http.js";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);
  const result = await getDb(env).execute({
    sql: `SELECT events.id, events.timestamp, events.type, people.label AS person,
                 events.video_status, events.video_error,
                 CASE WHEN events.image_key IS NULL THEN 0 ELSE 1 END AS has_image,
                 CASE WHEN events.video_key IS NULL THEN 0 ELSE 1 END AS has_video
          FROM events LEFT JOIN people ON people.id = events.person_id
          WHERE events.account_id = ? AND events.site_id = ? AND events.camera = ?
          ORDER BY events.timestamp DESC`,
    args: [data.accountId, params.site, camera.stream],
  });
  const columns = ["id", "timestamp", "type", "person", "video_status", "video_error", "has_image", "has_video"];
  const csv = [columns.join(","), ...result.rows.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\r\n");
  return new Response(`\uFEFF${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="camera-${camera.id}-events.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
