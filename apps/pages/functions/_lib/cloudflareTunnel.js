// Provisions a real Cloudflare Named Tunnel for a site, entirely
// server-side, using our own Cloudflare account/domain — the customer
// never needs their own Cloudflare account or domain. This replaces the
// earlier Quick Tunnel approach (ephemeral *.trycloudflare.com hostnames
// the relay self-registered on every restart): a named tunnel has a
// stable hostname known at creation time, and — unlike a Quick Tunnel's
// hostname on Cloudflare's own shared domain — it lives on our zone, so
// Cloudflare Access can actually be applied to it.
//
// One tunnel per site, with two public hostnames routed to the relay
// machine's two local ports (go2rtc and the relay's own API).
const CF_API = "https://api.cloudflare.com/client/v4";

async function cf(env, path, options = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Cloudflare API lỗi (${path}): ${JSON.stringify(data.errors)}`);
  }
  return data.result;
}

export async function createSiteTunnel(env, siteId) {
  const baseDomain = env.TUNNEL_BASE_DOMAIN; // e.g. "camera.schoolsai.work"
  const go2rtcHost = `${siteId}-go2rtc.${baseDomain}`;
  const relayHost = `${siteId}-relay.${baseDomain}`;

  const tunnel = await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name: `cameraaiwork-${siteId}`, config_src: "cloudflare" }),
  });

  // The create response has no token field — it's a separate call.
  const tunnelToken = await cf(
    env,
    `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/token`
  );

  await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/configurations`, {
    method: "PUT",
    body: JSON.stringify({
      config: {
        ingress: [
          { hostname: go2rtcHost, service: "http://localhost:1984" },
          { hostname: relayHost, service: "http://localhost:4000" },
          { service: "http_status:404" },
        ],
      },
    }),
  });

  for (const hostname of [go2rtcHost, relayHost]) {
    await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: hostname,
        content: `${tunnel.id}.cfargotunnel.com`,
        proxied: true,
      }),
    });
  }

  return {
    tunnelId: tunnel.id, // stored so the token can be re-fetched later without keeping it around
    tunnelToken, // string — cloudflared tunnel run --token <this>
    go2rtcUrl: `https://${go2rtcHost}`,
    relayUrl: `https://${relayHost}`,
  };
}

// Tears down everything createSiteTunnel made: the DNS records (looked up
// by name since we don't store their ids), then the tunnel itself.
export async function deleteSiteTunnel(env, siteId, tunnelId) {
  const baseDomain = env.TUNNEL_BASE_DOMAIN;
  const hostnames = [`${siteId}-go2rtc.${baseDomain}`, `${siteId}-relay.${baseDomain}`];

  for (const hostname of hostnames) {
    const records = await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?name=${hostname}`);
    for (const record of records) {
      await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${record.id}`, { method: "DELETE" });
    }
  }

  if (tunnelId) {
    await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}`, { method: "DELETE" });
  }
}
