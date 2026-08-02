// Central auth + CORS gate — API-first + multi-tenant: every request under
// /api/* (the dashboard UI included, since it calls the same API) must
// present a valid account API key, resolved once here into `data.accountId`
// so every handler just scopes its queries by it instead of re-implementing
// auth. CORS is handled here too, in one place, for the same reason.
//
// Exemptions:
//   /api/motion — machine-to-machine webhook from a site's relay,
//   authenticated with that site's own relay_secret (see functions/api/motion.js).
//   /api/health — unauthenticated so uptime monitors can hit it.
//   PATCH /api/sites/:id — same as /api/motion, the relay self-reports its
//   current Quick Tunnel URLs using its site's relay_secret, not an
//   account API key (see functions/api/sites/[id].js).
import { getDb } from "./_lib/db.js";

const PUBLIC_PATHS = ["/api/motion", "/api/health"];

function isSiteSelfUpdate(request, url) {
  return request.method === "PATCH" && /^\/api\/sites\/[^/]+$/.test(url.pathname);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allowList = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const allowOrigin = allowList.includes("*") ? "*" : allowList.includes(origin) ? origin : "";

  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-relay-secret",
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequest({ request, next, env, data }) {
  const url = new URL(request.url);
  const cors = corsHeaders(env, request);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return new Response(null, { status: 204, headers: cors });
  }

  if (
    !url.pathname.startsWith("/api/") ||
    PUBLIC_PATHS.includes(url.pathname) ||
    isSiteSelfUpdate(request, url)
  ) {
    return withCors(await next(), cors);
  }

  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return withCors(unauthorized(), cors);

  try {
    const keyHash = await sha256Hex(bearer);
    const db = getDb(env);
    const result = await db.execute({
      sql: "SELECT account_id FROM api_keys WHERE id = ? AND revoked_at IS NULL",
      args: [keyHash],
    });

    const row = result.rows[0];
    if (!row) return withCors(unauthorized(), cors);

    data.accountId = row.account_id;
  } catch (err) {
    console.error("Auth lookup thất bại:", err);
    return withCors(
      new Response(JSON.stringify({ error: "Auth backend unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      cors
    );
  }

  return withCors(await next(), cors);
}
