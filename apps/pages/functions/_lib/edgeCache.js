// Short-lived per-colo response cache for the dashboard's list endpoints, so
// several tabs/devices of one account share a single Neon query per TTL.
// Reads stay consistent for the user's own actions: every mutation calls
// bumpCacheVersion(), which changes the version in the cache key, so the next
// GET misses and sees fresh data. Changes made elsewhere (new motion events,
// other colos) show up within TTL seconds. No-ops where Cache API is absent.
const BASE = "https://edge-cache.internal";

function store() {
  return typeof caches !== "undefined" ? caches.default : null;
}

async function readVersion(cache, accountId) {
  const hit = await cache.match(`${BASE}/v/${accountId}`);
  return hit ? await hit.text() : "0";
}

export async function bumpCacheVersion(accountId) {
  const cache = store();
  if (!cache || !accountId) return;
  try {
    await cache.put(`${BASE}/v/${accountId}`, new Response(`${Date.now()}.${Math.random().toString(36).slice(2, 6)}`, {
      headers: { "Cache-Control": "max-age=86400" },
    }));
  } catch {}
}

// GET handlers: serve from cache when fresh, otherwise run and store 200s.
export function withEdgeCache(handler, ttlSeconds = 10) {
  return async (context) => {
    const cache = store();
    const accountId = context.data?.accountId;
    if (!cache || !accountId || context.request.method !== "GET") return handler(context);
    let key;
    try {
      const url = new URL(context.request.url);
      key = `${BASE}/d/${accountId}/${await readVersion(cache, accountId)}${url.pathname}${url.search}`;
      const hit = await cache.match(key);
      if (hit) {
        const headers = new Headers(hit.headers);
        headers.set("Cache-Control", "no-store");
        headers.set("X-Edge-Cache", "HIT");
        return new Response(hit.body, { status: hit.status, headers });
      }
    } catch { return handler(context); }
    const response = await handler(context);
    if (response.status === 200) {
      const copy = response.clone();
      const headers = new Headers(copy.headers);
      headers.set("Cache-Control", `max-age=${ttlSeconds}`);
      const put = cache.put(key, new Response(copy.body, { status: 200, headers })).catch(() => {});
      if (context.waitUntil) context.waitUntil(put); else await put;
    }
    return response;
  };
}

// Mutation handlers: invalidate the account's cached lists after a success.
export function withCacheBump(handler) {
  return async (context) => {
    const response = await handler(context);
    if (response.status < 400) await bumpCacheVersion(context.data?.accountId);
    return response;
  };
}
