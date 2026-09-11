// GET /api/people
// Lists every clustered person for the account, most recently seen
// first. `label` is null until named via PATCH /api/people/:id — the UI
// shows those as "Người lạ #<id>" or similar until then.
import { getDb } from "../../_lib/db.js";
import { json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ request, env, data }) => {
  const source = new URL(request.url).searchParams.get("source") === "gpu" ? "gpu" : "local";
  const peopleTable = source === "gpu" ? "gpu_people" : "people";
  const linksTable = source === "gpu" ? "event_gpu_people" : "event_people";
  const db = getDb(env);
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
          FROM ${peopleTable} people WHERE people.account_id = ? ORDER BY people.last_seen_at DESC`,
    args: [data.accountId],
  });
  return json(result.rows);
});
