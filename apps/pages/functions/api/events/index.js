import { withEdgeCache, withCacheBump } from "../../_lib/edgeCache.js";
import { parseKnown } from "../../_lib/delta.js";
import { getDb } from "../../_lib/db.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";
import { encodeEventCursor, eventWhere, parseEventQuery, validDate } from "../../_lib/events.js";

export const onRequestGet = withEdgeCache(withErrorHandling(async ({ request, env, data }) => {
  const url = new URL(request.url);
  let known;
  try { known = parseKnown(url); } catch { return errorJson("known không hợp lệ", 400); }
  const delta = url.searchParams.get("delta") === "1";
  const { limit, page, cursor, invalidPage, invalidCursor, filters } = parseEventQuery(url);
  if (invalidPage) return errorJson("page phải là số nguyên lớn hơn 0", 400);
  if (invalidCursor) return errorJson("cursor không hợp lệ", 400);
  if (page && cursor) return errorJson("chỉ dùng page hoặc cursor, không dùng đồng thời", 400);
  if ((filters.from && !validDate(filters.from)) || (filters.to && !validDate(filters.to))) {
    return errorJson("from/to phải là thời gian ISO hợp lệ", 400);
  }
  if (filters.from && filters.to && Date.parse(filters.from) > Date.parse(filters.to)) {
    return errorJson("from không được sau to", 400);
  }
  if (filters.acknowledged && !["true", "false"].includes(filters.acknowledged)) {
    return errorJson("acknowledged phải là true hoặc false", 400);
  }
  const { conditions, args } = eventWhere(data.accountId, filters, page ? null : cursor);

  const db = getDb(env, "api.events.index");
  const query = {
    sql: `
      SELECT events.*, people.label as person_label,
             COALESCE((
               SELECT json_agg(json_build_object('id', event_person.id, 'label', event_person.label) ORDER BY event_person.id)
               FROM event_people ep
               JOIN people event_person ON event_person.id = ep.person_id AND event_person.account_id = events.account_id
               WHERE ep.event_id = events.id
             ), '[]'::json) AS people
      FROM events
      LEFT JOIN people ON people.id = events.person_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY events.timestamp DESC, events.id DESC LIMIT ?${page ? " OFFSET ?" : ""}
    `,
    args: page ? [...args, limit, (page - 1) * limit] : [...args, limit + 1],
  };
  if (delta && !page) return errorJson("delta requires page", 400);
  if (delta) {
    query.sql = `WITH visible AS (${query.sql}), hashed AS (
      SELECT visible.*, md5(row_to_json(visible)::text) AS _version FROM visible
    ) SELECT COALESCE(json_agg(json_build_object('id', id, 'version', _version) ORDER BY timestamp DESC, id DESC), '[]'::json) AS manifest,
      COALESCE(json_agg(row_to_json(hashed) ORDER BY timestamp DESC, id DESC)
        FILTER (WHERE (?::jsonb ->> id::text) IS DISTINCT FROM _version), '[]'::json) AS changed FROM hashed`;
    query.args.push(JSON.stringify(known));
  }
  const [result, countResult] = await Promise.all([
    db.execute(query),
    page ? db.execute({
      sql: `SELECT COUNT(*) AS total FROM events WHERE ${conditions.join(" AND ")}`,
      args,
    }) : Promise.resolve(null),
  ]);
  const total = page ? Number(countResult.rows[0]?.total || 0) : null;
  if (delta) return json({
    rows: (result.rows[0]?.changed || []).map(row => ({ ...row, acknowledged: Boolean(row.acknowledged) })),
    manifest: result.rows[0]?.manifest || [], total,
  }, { headers: { "Cache-Control": "no-store" } });
  const hasMore = page ? page * limit < total : result.rows.length > limit;
  const rows = result.rows.slice(0, limit).map((row) => ({ ...row, acknowledged: Boolean(row.acknowledged) }));
  const nextCursor = !page && hasMore ? encodeEventCursor(rows.at(-1)) : null;
  return json(rows, { headers: {
    "X-Next-Cursor": nextCursor || "",
    "X-Has-More": String(hasMore),
    ...(page ? {
      "X-Total-Count": String(total),
      "X-Total-Pages": String(Math.ceil(total / limit)),
      "X-Current-Page": String(page),
    } : {}),
    "Access-Control-Expose-Headers": "X-Next-Cursor, X-Has-More, X-Total-Count, X-Total-Pages, X-Current-Page",
  } });
}));
