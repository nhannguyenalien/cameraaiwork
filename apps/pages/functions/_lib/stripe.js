const encoder = new TextEncoder();

export async function stripeRequest(env, path, fields) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe chưa được cấu hình");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) body.append(key, String(value));
  }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Stripe HTTP ${response.status}`);
  return data;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyStripeWebhook(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const fields = signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = fields.find(([name]) => name === "t")?.[1];
  const signatures = fields.filter(([name]) => name === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0 || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((candidate) => constantTimeEqual(expected, candidate));
}

export function subscriptionUpdateForEvent(event) {
  const object = event?.data?.object || {};
  const accountId = object.metadata?.account_id || object.client_reference_id;
  if (!accountId) return null;

  if (event.type === "checkout.session.completed") {
    return {
      accountId,
      customerId: object.customer || null,
      subscriptionId: object.subscription || null,
      status: "active",
      plan: "pro",
    };
  }

  if (["customer.subscription.created", "customer.subscription.updated"].includes(event.type)) {
    const status = object.status || "inactive";
    const active = ["active", "trialing"].includes(status);
    return {
      accountId,
      customerId: object.customer || null,
      subscriptionId: object.id || null,
      status,
      plan: active ? "pro" : "free",
    };
  }

  if (event.type === "customer.subscription.deleted") {
    return {
      accountId,
      customerId: object.customer || null,
      subscriptionId: object.id || null,
      status: object.status || "canceled",
      plan: "free",
    };
  }

  return null;
}
