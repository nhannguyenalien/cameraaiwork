import { getCamera } from "../../../../_lib/sites.js";
import { getDb } from "../../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";

function validTimeZone(value) {
  const timeZone = String(value || "UTC").slice(0, 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return null;
  }
}

export const onRequestGet = withErrorHandling(async ({ request, params, env, data }) => {
  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  const timeZone = validTimeZone(new URL(request.url).searchParams.get("timezone"));
  if (!timeZone) return errorJson("Múi giờ không hợp lệ", 400);

  const dayExpression = "TO_CHAR(timestamp AT TIME ZONE ?, 'YYYY-MM-DD')";
  const result = await getDb(env).execute({
    sql: `
      SELECT ${dayExpression} AS day,
             MAX(timestamp) AS "lastVideoAt",
             COUNT(*) AS "videoCount"
      FROM events
      WHERE account_id = ? AND site_id = ? AND camera = ?
        AND video_key IS NOT NULL AND video_key <> ''
      GROUP BY 1
      ORDER BY day DESC
      LIMIT 730
    `,
    args: [timeZone, data.accountId, params.site, camera.stream],
  });

  return json(result.rows.map((row) => ({
    day: row.day,
    lastVideoAt: row.lastVideoAt,
    videoCount: Number(row.videoCount || 0),
  })));
});
