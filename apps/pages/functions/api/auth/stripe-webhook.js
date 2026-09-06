import { getDb } from "../../_lib/db.js";
import { subscriptionUpdateForEvent, verifyStripeWebhook } from "../../_lib/stripe.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  if (!env.STRIPE_WEBHOOK_SECRET) return errorJson("Webhook chưa cấu hình", 503);
  const payload = await request.text();
  const valid = await verifyStripeWebhook(payload, request.headers.get("stripe-signature") || "", env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return errorJson("Invalid Stripe signature", 400);
  const event = JSON.parse(payload);
  const update = subscriptionUpdateForEvent(event);
  if (update) {
    await getDb(env).execute({
      sql: "UPDATE accounts SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id), subscription_status = ?, plan = ? WHERE id = ?",
      args: [update.customerId, update.subscriptionId, update.status, update.plan, update.accountId],
    });
  }
  return json({ received: true });
});
