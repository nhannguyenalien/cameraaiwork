import { getDb } from "../../_lib/db.js";
import { json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ request, env, data }) => {
  const url = new URL(request.url);
  const site = url.searchParams.get("site");
  const camera = url.searchParams.get("camera");
  const limit = Math.min(Number(url.searchParams.get("limit") || 20) || 20, 100);

  const conditions = ["events.account_id = ?"];
  const args = [data.accountId];

  if (site) {
    conditions.push("events.site_id = ?");
    args.push(site);
  }
  if (camera) {
    conditions.push("events.camera = ?");
    args.push(camera);
  }

  const db = getDb(env);
  const result = await db.execute({
    sql: `
      SELECT events.*, people.label as person_label
      FROM events
      LEFT JOIN people ON people.id = events.person_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY events.timestamp DESC LIMIT ?
    `,
    args: [...args, limit],
  });
  return json(result.rows);
});
