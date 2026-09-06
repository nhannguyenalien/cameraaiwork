import assert from "node:assert/strict";
import test from "node:test";
import { limitsFor } from "../functions/_lib/plans.js";

test("free and unknown plans use conservative limits", () => {
  assert.deepEqual(limitsFor("free"), { sites: 1, cameras: 2, viewersPerCamera: 1 });
  assert.deepEqual(limitsFor("enterprise"), { sites: 1, cameras: 2, viewersPerCamera: 1 });
});

test("pro plan expands site and camera capacity", () => {
  assert.deepEqual(limitsFor("pro"), { sites: 10, cameras: 32, viewersPerCamera: 5 });
});
