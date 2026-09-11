import test from "node:test";
import assert from "node:assert/strict";
import { validateResourceName } from "../functions/_lib/resourceNames.js";

test("camera and site names are trimmed and bounded", () => {
  assert.equal(validateResourceName("  Nhà chính  ", "site"), "Nhà chính");
  assert.equal(validateResourceName(" Cổng trước ", "camera"), "Cổng trước");
  assert.equal(validateResourceName("x".repeat(120), "camera").length, 120);
});

test("camera and site names reject empty or oversized values", () => {
  assert.throws(() => validateResourceName("   ", "site"), /1 đến 120/);
  assert.throws(() => validateResourceName("x".repeat(121), "camera"), /1 đến 120/);
  assert.throws(() => validateResourceName(null, "camera"), /1 đến 120/);
});
