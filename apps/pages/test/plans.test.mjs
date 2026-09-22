import assert from "node:assert/strict";
import test from "node:test";
import { effectivePlanForAccountRow, limitsFor, normalizeClipDuration } from "../functions/_lib/plans.js";

test("free and unknown plans use conservative limits", () => {
  assert.deepEqual(limitsFor("free"), { sites: 3, cameras: 10, viewersPerCamera: 1, clipDurations: [10], maxVideoRetentionDays: 7 });
  assert.deepEqual(limitsFor("enterprise"), { sites: 3, cameras: 10, viewersPerCamera: 1, clipDurations: [10], maxVideoRetentionDays: 7 });
});

test("pro plan expands site and camera capacity", () => {
  assert.deepEqual(limitsFor("pro"), { sites: 10, cameras: null, viewersPerCamera: 5, clipDurations: [10, 30, 60], maxVideoRetentionDays: 364 });
});

test("clip duration and paid entitlement are enforced server-side", () => {
  assert.equal(normalizeClipDuration("free", 60), 10);
  assert.equal(normalizeClipDuration("pro", 30), 30);
  assert.equal(normalizeClipDuration("pro", 60), 60);
  assert.equal(normalizeClipDuration("pro", 45), 10);
  assert.equal(effectivePlanForAccountRow({ plan: "pro", subscription_status: "active" }), "pro");
  assert.equal(effectivePlanForAccountRow({ plan: "pro", subscription_status: "canceled" }), "free");
});
