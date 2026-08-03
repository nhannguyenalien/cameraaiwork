// GET /api/people
// Lists every clustered person for the account, most recently seen
// first. `label` is null until named via PATCH /api/people/:id — the UI
// shows those as "Người lạ #<id>" or similar until then.
import { getDb } from "../../_lib/db.js";
import { json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const db = getDb(env);
  const result = await db.execute({
    sql: `SELECT id, label, first_seen_at, last_seen_at, seen_count
          FROM people WHERE account_id = ? ORDER BY last_seen_at DESC`,
    args: [data.accountId],
  });
  return json(result.rows);
});
