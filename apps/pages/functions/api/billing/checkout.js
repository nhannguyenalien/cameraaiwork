import { getDb } from "../../_lib/db.js";
import { stripeRequest } from "../../_lib/stripe.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  if (!env.STRIPE_PRICE_ID) return errorJson("Stripe price chưa được cấu hình", 503);
  const account = (await getDb(env).execute({ sql: "SELECT * FROM accounts WHERE id = ?", args: [data.accountId] })).rows[0];
  const origin = new URL(request.url).origin;
  const session = await stripeRequest(env, "checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": env.STRIPE_PRICE_ID,
    "line_items[0][quantity]": 1,
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancelled`,
    client_reference_id: account.id,
    customer: account.stripe_customer_id || undefined,
    customer_email: account.stripe_customer_id ? undefined : account.email,
    "subscription_data[metadata][account_id]": account.id,
  });
  return json({ url: session.url });
});
