// Resolved API-key cache, two layers in front of Neon:
//   1. per-isolate Map (30s)  — free, no I/O
//   2. KV namespace CACHE (60s, KV's minimum TTL) — shared across isolates/colos
// Revocation: logout calls forgetAuth() (immediate in this isolate and KV
// within KV's propagation delay); anything else expires within the TTLs.
// Keys are SHA-256 hashes, never raw tokens. KV is optional: no binding = skip.
const LOCAL_MS = 30_000;
const LOCAL_MAX = 500;
const KV_TTL_SECONDS = 60;
const local = new Map();

const kvKey = (hash) => `auth:${hash}`;

export async function getCachedAuth(env, hash) {
  const hit = local.get(hash);
  if (hit && hit.until > Date.now()) return hit.row;
  local.delete(hash);
  if (!env.CACHE) return null;
  try {
    const row = await env.CACHE.get(kvKey(hash), "json");
    if (row) setLocal(hash, row);
    return row || null;
  } catch { return null; }
}

function setLocal(hash, row) {
  if (local.size >= LOCAL_MAX) local.delete(local.keys().next().value);
  local.set(hash, { row, until: Date.now() + LOCAL_MS });
}

export async function setCachedAuth(env, hash, row, waitUntil) {
  setLocal(hash, row);
  if (!env.CACHE) return;
  const write = env.CACHE.put(kvKey(hash), JSON.stringify(row), { expirationTtl: KV_TTL_SECONDS }).catch(() => {});
  if (waitUntil) waitUntil(write); else await write;
}

export async function forgetAuth(env, hash) {
  local.delete(hash);
  if (env.CACHE) await env.CACHE.delete(kvKey(hash)).catch(() => {});
}
