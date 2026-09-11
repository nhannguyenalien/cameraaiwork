import test from "node:test";
import assert from "node:assert/strict";
import { decodeEventCursor, encodeEventCursor, eventWhere, parseByteRange, parseEventQuery } from "../functions/_lib/events.js";

test("event cursor round-trips timestamp and id", () => {
  const row = { timestamp: "2026-09-08T12:34:56.000Z", id: 42 };
  assert.deepEqual(decodeEventCursor(encodeEventCursor(row)), row);
  assert.equal(decodeEventCursor("not-a-cursor"), null);
});

test("event query caps limit and detects an invalid cursor", () => {
  const parsed = parseEventQuery(new URL("https://example.test/api/events?limit=999&cursor=bad"));
  assert.equal(parsed.limit, 100);
  assert.equal(parsed.invalidCursor, true);
});

test("event query accepts positive page numbers and rejects invalid pages", () => {
  assert.equal(parseEventQuery(new URL("https://example.test/api/events?page=3")).page, 3);
  assert.equal(parseEventQuery(new URL("https://example.test/api/events")).page, null);
  assert.equal(parseEventQuery(new URL("https://example.test/api/events?page=0")).invalidPage, true);
  assert.equal(parseEventQuery(new URL("https://example.test/api/events?page=1.5")).invalidPage, true);
});

test("event person filter covers every face linked to an event", () => {
  const { conditions, args } = eventWhere("acct-1", { person: "person-2" }, null);
  assert.match(conditions.join(" "), /EXISTS \(SELECT 1 FROM event_people/);
  assert.deepEqual(args, ["acct-1", "person-2"]);
});

test("byte ranges support explicit, open-ended and suffix forms", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19, length: 10 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99, length: 10 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99, length: 10 });
  assert.deepEqual(parseByteRange("bytes=100-101", 100), { invalid: true });
});
