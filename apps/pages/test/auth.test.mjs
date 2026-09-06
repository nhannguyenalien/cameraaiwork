import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, validateNewPassword, validateSignupInput } from "../functions/_lib/auth.js";

test("signup rejects missing and malformed credentials as client errors", () => {
  for (const input of [{}, { email: "x@example.com" }, { password: "long-enough-password" }, { email: "not-an-email", password: "long-enough-password" }]) {
    assert.throws(() => validateSignupInput(input));
  }
});

test("password change applies the same password bounds as signup", () => {
  assert.equal(validateNewPassword("long-enough-password"), "long-enough-password");
  assert.throws(() => validateNewPassword("too-short"), /PASSWORD_WEAK/);
  assert.throws(() => validateNewPassword("x".repeat(1025)), /PASSWORD_WEAK/);
});

test("signup normalizes bounded customer identity fields", () => {
  const result = validateSignupInput({
    email: "  Owner@Example.COM ",
    password: "long-enough-password",
    name: `  ${"a".repeat(140)}  `,
  });
  assert.equal(result.normalizedEmail, "owner@example.com");
  assert.equal(result.normalizedName.length, 120);
});

test("legacy account email is normalized and validated", () => {
  assert.equal(normalizeEmail("  Demo@Example.COM "), "demo@example.com");
  assert.throws(() => normalizeEmail("not-an-email"), /EMAIL_INVALID/);
});
