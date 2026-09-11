const MAX_LIMIT = 100;

export function parseEventQuery(url) {
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 20, MAX_LIMIT));
  const pageValue = url.searchParams.get("page");
  const pageNumber = Number(pageValue);
  const page = pageValue == null ? null : pageNumber;
  const filters = {
    site: url.searchParams.get("site") || null,
    camera: url.searchParams.get("camera") || null,
    type: url.searchParams.get("type") || null,
    person: url.searchParams.get("person") || null,
    videoStatus: url.searchParams.get("videoStatus") || null,
    faceScanStatus: url.searchParams.get("faceScanStatus") || null,
    acknowledged: url.searchParams.get("acknowledged"),
    from: url.searchParams.get("from") || null,
    to: url.searchParams.get("to") || null,
  };
  const cursorValue = url.searchParams.get("cursor");
  const cursor = decodeEventCursor(cursorValue);
  return {
    limit,
    page,
    cursor,
    invalidPage: Boolean(pageValue != null && (!Number.isSafeInteger(pageNumber) || pageNumber < 1)),
    invalidCursor: Boolean(cursorValue && !cursor),
    filters,
  };
}

export function encodeEventCursor(row) {
  if (!row?.timestamp || row.id == null) return null;
  const raw = `${row.timestamp}|${row.id}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeEventCursor(value) {
  if (!value) return null;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const raw = new TextDecoder().decode(bytes);
    const separator = raw.lastIndexOf("|");
    const timestamp = raw.slice(0, separator);
    const id = Number(raw.slice(separator + 1));
    if (separator < 1 || !Number.isSafeInteger(id) || id < 1 || !validDate(timestamp)) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}

export function validDate(value) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

export function eventWhere(accountId, filters, cursor) {
  const conditions = ["events.account_id = ?"];
  const args = [accountId];
  const equals = [
    ["site", "events.site_id"], ["camera", "events.camera"], ["type", "events.type"],
    ["videoStatus", "events.video_status"],
    ["faceScanStatus", "events.face_scan_status"],
  ];
  for (const [key, column] of equals) {
    if (filters[key]) { conditions.push(`${column} = ?`); args.push(filters[key]); }
  }
  if (filters.person) {
    conditions.push("EXISTS (SELECT 1 FROM event_people ep WHERE ep.event_id = events.id AND ep.person_id = ?)");
    args.push(filters.person);
  }
  if (filters.acknowledged === "true" || filters.acknowledged === "false") {
    conditions.push("events.acknowledged = ?");
    args.push(filters.acknowledged === "true" ? 1 : 0);
  }
  if (validDate(filters.from)) { conditions.push("events.timestamp >= ?"); args.push(filters.from); }
  if (validDate(filters.to)) { conditions.push("events.timestamp <= ?"); args.push(filters.to); }
  if (cursor) {
    conditions.push("(events.timestamp < ? OR (events.timestamp = ? AND events.id < ?))");
    args.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  return { conditions, args };
}

export function parseByteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || !Number.isFinite(size) || size < 1) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return { invalid: true };
  end = Math.min(end, size - 1);
  return { start, end, length: end - start + 1 };
}
