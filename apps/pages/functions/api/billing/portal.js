import { getDb } from "../../_lib/db.js";
import { stripeRequest } from "../../_lib/stripe.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const account = (await getDb(env).execute({ sql: "SELECT stripe_customer_id FROM accounts WHERE id = ?", args: [data.accountId] })).rows[0];
  if (!account?.stripe_customer_id) return errorJson("Chưa có subscription", 400);
  const session = await stripeRequest(env, "billing_portal/sessions", { customer: account.stripe_customer_id, return_url: new URL(request.url).origin });
  return json({ url: session.url });
});
