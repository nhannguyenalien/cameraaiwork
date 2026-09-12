import { getDb } from "../../../_lib/db.js";
import { errorJson, json, withErrorHandling } from "../../../_lib/http.js";
import { deleteObjects } from "../../../_lib/objectStorage.js";

async function findEvent(env, accountId, id) {
  const result = await getDb(env).execute({
    sql: `SELECT events.*, people.label AS person_label
          FROM events LEFT JOIN people ON people.id = events.person_id
          WHERE events.id = ? AND events.account_id = ?`,
    args: [id, accountId],
  });
  const event = result.rows[0];
  return event ? { ...event, acknowledged: Boolean(event.acknowledged) } : null;
}

export const onRequestGet = withErrorHandling(async ({ params, env, data }) => {
  const event = await findEvent(env, data.accountId, params.id);
  if (!event) return errorJson("Event not found", 404);
  const people = await getDb(env).execute({
    sql: `SELECT people.id, people.label FROM event_people
          JOIN people ON people.id = event_people.person_id
          WHERE event_people.event_id = ? AND people.account_id = ?`,
    args: [params.id, data.accountId],
  });
  return json({ ...event, people: people.rows });
});

export const onRequestPatch = withErrorHandling(async ({ request, params, env, data }) => {
  const event = await findEvent(env, data.accountId, params.id);
  if (!event) return errorJson("Event not found", 404);
  const body = await request.json().catch(() => null);
  if (!body || (body.acknowledged === undefined && body.note === undefined)) return errorJson("Không có trường cần cập nhật", 400);
  if (body.acknowledged !== undefined && typeof body.acknowledged !== "boolean") return errorJson("acknowledged phải là boolean", 400);
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return errorJson("note phải là chuỗi hoặc null", 400);
  const note = body.note === undefined ? event.note : (body.note === null ? null : body.note.trim().slice(0, 2000));
  const acknowledged = body.acknowledged === undefined ? Number(event.acknowledged) : (body.acknowledged ? 1 : 0);
  await getDb(env).execute({
    sql: "UPDATE events SET acknowledged = ?, note = ? WHERE id = ? AND account_id = ?",
    args: [acknowledged, note, params.id, data.accountId],
  });
  return json({ ok: true, acknowledged: Boolean(acknowledged), note });
});

export const onRequestDelete = withErrorHandling(async ({ params, env, data }) => {
  const event = await findEvent(env, data.accountId, params.id);
  if (!event) return errorJson("Event not found", 404);
  await deleteObjects(env, data.accountId, event.storage_backend || "r2", [event.image_key, event.video_key].filter(Boolean));
  await getDb(env).execute({ sql: "DELETE FROM events WHERE id = ? AND account_id = ?", args: [params.id, data.accountId] });
  return json({ ok: true });
});
