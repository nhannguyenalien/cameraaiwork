import test from "node:test";
import assert from "node:assert/strict";
import { validateApiKeyInput } from "../functions/_lib/apiKeys.js";

test("accepts a labeled full-scope key with no expiry by default", () => {
  const result = validateApiKeyInput({ label: "CI script", scope: "full" });
  assert.deepEqual(result, { label: "CI script", scope: "full", expiresInDays: null });
});

test("accepts a bounded expiry", () => {
  assert.equal(validateApiKeyInput({ label: "x", scope: "read", expiresInDays: 30 }).expiresInDays, 30);
  assert.throws(() => validateApiKeyInput({ label: "x", scope: "read", expiresInDays: 0 }), /expiresInDays/);
  assert.throws(() => validateApiKeyInput({ label: "x", scope: "read", expiresInDays: 366 }), /expiresInDays/);
  assert.throws(() => validateApiKeyInput({ label: "x", scope: "read", expiresInDays: 1.5 }), /expiresInDays/);
});

test("rejects a missing or oversized label", () => {
  assert.throws(() => validateApiKeyInput({ label: "", scope: "full" }), /Tên key/);
  assert.throws(() => validateApiKeyInput({ label: "   ", scope: "full" }), /Tên key/);
  assert.throws(() => validateApiKeyInput({ label: "x".repeat(101), scope: "full" }), /Tên key/);
});

test("reserves the 'web ' label prefix for browser session tokens", () => {
  assert.throws(() => validateApiKeyInput({ label: "web login", scope: "full" }), /web /);
  assert.throws(() => validateApiKeyInput({ label: "Web anything", scope: "full" }), /web /);
});

test("rejects an unknown scope", () => {
  assert.throws(() => validateApiKeyInput({ label: "x", scope: "admin" }), /scope/);
  assert.throws(() => validateApiKeyInput({ label: "x" }), /scope/);
});
