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
//   /api/auth/* — obviously can't require an API key, since the whole
//   point is exchanging a Google sign-in for one (see functions/api/auth/google/).
//
//   Google Drive's OAuth connect flow (functions/api/settings/storage-config/
//   google-exchange.js + google-finalize.js) runs entirely as authenticated
//   API calls from the dashboard's own JS (Google Identity Services' popup
//   code flow, not a full-page redirect), so it needs no exemption here.
import { getDb } from "./_lib/db.js";
import { sha256Hex } from "./_lib/ids.js";
import { readSessionToken } from "./_lib/session.js";

const PUBLIC_PATHS = ["/api/motion", "/api/face-backfill", "/api/health", "/api/internal/maintenance", "/api/internal/patrol", "/api/install/claim", "/api/support/chat"];
const PUBLIC_AUTH_PATHS = ["/api/auth/signup", "/api/auth/login", "/api/auth/stripe-webhook"];

function isPublic(request, url) {
  return PUBLIC_PATHS.includes(url.pathname) || PUBLIC_AUTH_PATHS.includes(url.pathname);
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const sameOrigin = new URL(request.url).origin;
  const allowList = (env.ALLOWED_ORIGINS || sameOrigin).split(",").map((s) => s.trim());
  const allowOrigin = allowList.includes(origin) ? origin : "";

  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-relay-secret",
    "Vary": "Origin",
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

  if (!url.pathname.startsWith("/api/") || isPublic(request, url)) {
    return withCors(await next(), cors);
  }

  const token = readSessionToken(request);
  if (!token) return withCors(unauthorized(), cors);

  try {
    const keyHash = await sha256Hex(token);
    const db = getDb(env);
    const result = await db.execute({
      sql: "SELECT account_id, scope FROM api_keys WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)",
      args: [keyHash],
    });

    const row = result.rows[0];
    if (!row) return withCors(unauthorized(), cors);

    // A 'read' key (see functions/api/settings/api-keys.js) may only issue
    // GET requests — everything else needs a 'full' key. This is a
    // deliberately coarse boundary (method, not per-endpoint): some GET-like
    // actions are POST (agent query, LAN camera discovery) and are simply
    // out of reach for a 'read' key rather than individually allow-listed,
    // which would drift out of sync as endpoints are added.
    if (row.scope === "read" && request.method !== "GET" && request.method !== "HEAD") {
      return withCors(
        new Response(JSON.stringify({ error: "This API key is read-only (GET requests only)" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
        cors
      );
    }

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
