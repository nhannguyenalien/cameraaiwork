// GET /api/people
// Lists a bounded page of clustered people for the account, most recently seen
// first. `label` is null until named via PATCH /api/people/:id — the UI
// shows those as "Người lạ #<id>" or similar until then.
import { getDb } from "../../_lib/db.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ request, env, data }) => {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || 1);
  const limit = Number(url.searchParams.get("limit") || 12);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return errorJson("Invalid page/limit", 400);
  const filter = url.searchParams.get("filter") || "all";
  if (!["all", "named", "unnamed"].includes(filter)) return errorJson("Invalid filter", 400);
  const search = (url.searchParams.get("search") || "").slice(0, 200);
  const source = url.searchParams.get("source") === "gpu" ? "gpu" : "local";
  const peopleTable = source === "gpu" ? "gpu_people" : "people";
  const linksTable = source === "gpu" ? "event_gpu_people" : "event_people";
  const db = getDb(env, "api.people.index");
  const conditions = ["people.account_id = ?"];
  const args = [data.accountId];
  if (filter !== "all") conditions.push(`NULLIF(trim(people.label), '') IS ${filter === "named" ? "NOT " : ""}NULL`);
  if (search) { conditions.push("strpos(lower(COALESCE(people.label, '')), lower(?)) > 0"); args.push(search); }
  const result = await db.execute({
    sql: `SELECT people.id, people.label, people.first_seen_at, people.last_seen_at, people.seen_count,
                 (SELECT ep.event_id FROM ${linksTable} ep
                  JOIN events e ON e.id = ep.event_id
                  WHERE ep.person_id = people.id AND e.account_id = people.account_id AND e.image_key IS NOT NULL
                  ORDER BY (ep.face_box IS NOT NULL) DESC, ep.event_id DESC LIMIT 1) AS preview_event_id,
                 (SELECT ep.face_box FROM ${linksTable} ep
                  JOIN events e ON e.id = ep.event_id
                  WHERE ep.person_id = people.id AND e.account_id = people.account_id AND e.image_key IS NOT NULL
                  ORDER BY (ep.face_box IS NOT NULL) DESC, ep.event_id DESC LIMIT 1) AS preview_face_box
          FROM ${peopleTable} people WHERE ${conditions.join(" AND ")} ORDER BY people.last_seen_at DESC, people.id DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, (page - 1) * limit],
  });
  const counts = await db.execute({
    sql: `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE NULLIF(trim(label), '') IS NULL) AS unnamed,
      COUNT(*) FILTER (WHERE ${conditions.join(" AND ")}) AS filtered FROM ${peopleTable} people WHERE account_id = ?`,
    args: [...args, data.accountId],
  });
  return json(result.rows, { headers: {
    "X-Total-Count": String(counts.rows[0].total), "X-Unnamed-Count": String(counts.rows[0].unnamed),
    "X-Filtered-Count": String(counts.rows[0].filtered), "Cache-Control": "no-store",
    "Access-Control-Expose-Headers": "X-Total-Count, X-Unnamed-Count, X-Filtered-Count",
  } });
});
