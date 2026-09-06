// Provisions a real Cloudflare Named Tunnel for a site, entirely
// server-side, using our own Cloudflare account/domain — the customer
// never needs their own Cloudflare account or domain. This replaces the
// earlier Quick Tunnel approach (ephemeral *.trycloudflare.com hostnames
// the relay self-registered on every restart): a named tunnel has a
// stable hostname known at creation time. Customer authentication is owned
// by the SaaS; Cloudflare Access is deliberately not part of this path.
//
// MVP invariant: one tunnel + one hostname per site. The only tunnel origin
// is the relay on localhost:4000. go2rtc and the local AI worker are never
// direct tunnel origins; the relay gates and proxies the small surface they
// need to expose.
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

async function cfPage(env, path) {
  const res = await fetch(`${CF_API}${path}`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Cloudflare API lỗi (${path}): ${JSON.stringify(data.errors)}`);
  return { result: data.result, resultInfo: data.result_info || {} };
}

export async function createSiteTunnel(env, siteId) {
  const baseDomain = env.TUNNEL_BASE_DOMAIN; // e.g. "camera.schoolsai.work"
  const siteHost = `${siteId}.${baseDomain}`;

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
          { hostname: siteHost, service: "http://localhost:4000" },
          { service: "http_status:404" },
        ],
      },
    }),
  });

  await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "CNAME",
      name: siteHost,
      content: `${tunnel.id}.cfargotunnel.com`,
      proxied: true,
    }),
  });

  const siteUrl = `https://${siteHost}`;

  return {
    tunnelId: tunnel.id, // stored so the token can be re-fetched later without keeping it around
    tunnelToken, // string — cloudflared tunnel run --token <this>
    go2rtcUrl: `${siteUrl}/internal/go2rtc`,
    relayUrl: siteUrl,
    aiWorkerUrl: `${siteUrl}/internal/ai`,
  };
}

export async function getSiteTunnelToken(env, tunnelId) {
  if (!tunnelId) throw new Error("Site chưa có named tunnel");
  return cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`);
}

// In-place migration from the old three-host layout. The connector keeps
// its tunnel id/token, while ingress and DNS converge to one hostname.
export async function consolidateSiteTunnel(env, siteId, tunnelId) {
  if (!tunnelId) throw new Error("Site chưa có named tunnel");
  const siteHost = `${siteId}.${env.TUNNEL_BASE_DOMAIN}`;
  const path = `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`;
  const current = await cf(env, path);
  await cf(env, path, {
    method: "PUT",
    body: JSON.stringify({
      config: {
        ...(current?.config || {}),
        ingress: [
          { hostname: siteHost, service: "http://localhost:4000" },
          { service: "http_status:404" },
        ],
      },
    }),
  });

  const records = await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?name=${encodeURIComponent(siteHost)}`);
  if (!records.length) {
    await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: siteHost,
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
      }),
    });
  }

  for (const suffix of ["go2rtc", "relay", "ai"]) {
    const oldHost = `${siteId}-${suffix}.${env.TUNNEL_BASE_DOMAIN}`;
    const oldRecords = await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?name=${encodeURIComponent(oldHost)}`);
    for (const record of oldRecords) {
      await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${record.id}`, { method: "DELETE" });
    }
  }

  const siteUrl = `https://${siteHost}`;
  return {
    go2rtcUrl: `${siteUrl}/internal/go2rtc`,
    relayUrl: siteUrl,
    aiWorkerUrl: `${siteUrl}/internal/ai`,
  };
}

// Tears down everything createSiteTunnel made: the DNS records (looked up
// by name since we don't store their ids), then the tunnel itself.
export async function deleteSiteTunnel(env, siteId, tunnelId) {
  const baseDomain = env.TUNNEL_BASE_DOMAIN;
  const hostnames = [
    `${siteId}.${baseDomain}`,
    `${siteId}-go2rtc.${baseDomain}`,
    `${siteId}-relay.${baseDomain}`,
    `${siteId}-ai.${baseDomain}`,
  ];

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

// Inventory only resources owned by this product. Other tunnels in the
// Cloudflare account must never be considered cleanup candidates.
export async function managedInfrastructure(env) {
  const tunnelsPage = await cfPage(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel?is_deleted=false&per_page=1000`);
  const dnsPage = await cfPage(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&per_page=5000`);
  const tunnels = tunnelsPage.result.filter((item) => item.name?.startsWith("cameraaiwork-"));
  const managedTargets = new Set(tunnels.map((item) => `${item.id}.cfargotunnel.com`));
  const dnsRecords = dnsPage.result.filter(
    (item) =>
      managedTargets.has(item.content) &&
      (item.name === env.TUNNEL_BASE_DOMAIN || item.name?.endsWith(`.${env.TUNNEL_BASE_DOMAIN}`))
  );
  return {
    tunnels,
    dnsRecords,
    accountTunnelCount: Number(tunnelsPage.resultInfo.total_count ?? tunnelsPage.result.length),
    zoneCnameCount: Number(dnsPage.resultInfo.total_count ?? dnsPage.result.length),
  };
}

export function orphanTunnelCandidates(tunnels, referencedTunnelIds, cutoff) {
  return tunnels.filter((tunnel) => {
    const createdAt = Date.parse(tunnel.created_at);
    return !referencedTunnelIds.has(tunnel.id) && Number.isFinite(createdAt) && createdAt <= cutoff;
  });
}

export async function cleanupOrphanTunnels(env, referencedTunnelIds, options = {}) {
  const inventory = options.inventory || (await managedInfrastructure(env));
  const configuredGraceHours = Number(options.graceHours ?? env.ORPHAN_TUNNEL_GRACE_HOURS ?? 6);
  const graceHours = Number.isFinite(configuredGraceHours) && configuredGraceHours > 0
    ? configuredGraceHours
    : 6;
  const cutoff = Date.now() - graceHours * 60 * 60 * 1000;
  const deleted = [];

  for (const tunnel of orphanTunnelCandidates(inventory.tunnels, referencedTunnelIds, cutoff)) {
    const target = `${tunnel.id}.cfargotunnel.com`;
    const matchingRecords = inventory.dnsRecords.filter((item) => item.content === target);
    for (const record of matchingRecords) {
      await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${record.id}`, { method: "DELETE" });
    }
    await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}`, { method: "DELETE" });
    deleted.push({ id: tunnel.id, name: tunnel.name, dnsRecordsDeleted: matchingRecords.length });
  }
  return deleted;
}
