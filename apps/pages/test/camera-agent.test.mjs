import assert from "node:assert/strict";
import test from "node:test";
import { buildVisits, resolveTimeRange } from "../functions/_lib/cameraAgent.js";

test("today uses the caller timezone instead of the server timezone", () => {
  const range = resolveTimeRange("Hôm nay có ai đến?", {
    now: new Date("2026-09-08T02:00:00.000Z"),
    timezoneOffsetMinutes: 420,
  });
  assert.equal(range.start.toISOString(), "2026-09-07T17:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-08T17:00:00.000Z");
});

test("yesterday and explicit dates resolve to bounded UTC ranges", () => {
  const options = { now: new Date("2026-09-08T02:00:00.000Z"), timezoneOffsetMinutes: 420 };
  assert.equal(resolveTimeRange("hôm qua", options).start.toISOString(), "2026-09-06T17:00:00.000Z");
  assert.equal(resolveTimeRange("ngày 2026-09-01", options).start.toISOString(), "2026-08-31T17:00:00.000Z");
});

test("events for one person are grouped into visits with an inactivity gap", () => {
  const events = [
    { id: 1, timestamp: "2026-09-08T01:00:00Z", camera: "front", people: [{ id: "p1", label: "An" }] },
    { id: 2, timestamp: "2026-09-08T01:05:00Z", camera: "hall", people: [{ id: "p1", label: "An" }] },
    { id: 3, timestamp: "2026-09-08T02:00:00Z", camera: "front", people: [{ id: "p1", label: "An" }] },
  ];
  const visits = buildVisits(events);
  assert.equal(visits.length, 2);
  assert.deepEqual(visits[0].eventIds, [1, 2]);
  assert.equal(visits[0].departureEstimated, true);
  assert.deepEqual(visits[0].cameras, ["front", "hall"]);
});
