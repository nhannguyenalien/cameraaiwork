import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionUpdateForEvent, verifyStripeWebhook } from "../functions/_lib/stripe.js";

async function sign(secret, timestamp, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return Buffer.from(bytes).toString("hex");
}

test("accepts a current valid Stripe signature", async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = '{"id":"evt_test"}';
  const signature = await sign("whsec_test", timestamp, payload);
  assert.equal(await verifyStripeWebhook(payload, `t=${timestamp},v1=${signature}`, "whsec_test"), true);
});

test("accepts any valid v1 signature during Stripe key rotation", async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = "{}";
  const signature = await sign("whsec_test", timestamp, payload);
  assert.equal(await verifyStripeWebhook(payload, `t=${timestamp},v1=invalid,v1=${signature}`, "whsec_test"), true);
});

test("rejects expired, malformed, and incorrect signatures", async () => {
  const oldTimestamp = Math.floor(Date.now() / 1000) - 301;
  assert.equal(await verifyStripeWebhook("{}", `t=${oldTimestamp},v1=bad`, "whsec_test"), false);
  assert.equal(await verifyStripeWebhook("{}", "", "whsec_test"), false);
  assert.equal(await verifyStripeWebhook("{}", `t=${Math.floor(Date.now() / 1000)},v1=bad`, "whsec_test"), false);
});

test("checkout completion activates Pro immediately", () => {
  const update = subscriptionUpdateForEvent({
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "acct-1", customer: "cus_1", subscription: "sub_1", status: "complete" } },
  });
  assert.deepEqual(update, {
    accountId: "acct-1",
    customerId: "cus_1",
    subscriptionId: "sub_1",
    status: "active",
    plan: "pro",
  });
});

test("subscription lifecycle follows active status and returns to Free", () => {
  const base = { metadata: { account_id: "acct-1" }, id: "sub_1", customer: "cus_1" };
  assert.equal(subscriptionUpdateForEvent({ type: "customer.subscription.created", data: { object: { ...base, status: "trialing" } } }).plan, "pro");
  assert.equal(subscriptionUpdateForEvent({ type: "customer.subscription.updated", data: { object: { ...base, status: "past_due" } } }).plan, "free");
  assert.equal(subscriptionUpdateForEvent({ type: "customer.subscription.deleted", data: { object: { ...base, status: "canceled" } } }).plan, "free");
});
