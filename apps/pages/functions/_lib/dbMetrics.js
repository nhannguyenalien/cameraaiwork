// Application payload estimate, NOT Neon billed wire bytes (TLS/HTTP metadata,
// compression, and retries differ). Never log query text, params, or row values.
export function queryFingerprint(query) {
  let hash = 2166136261;
  for (const char of query) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
export async function measureDb(env, flow, query, operation) {
  const start = Date.now();
  let result;
  let ok = false;
  try { result = await operation(); ok = true; return result; }
  finally {
    if (env.DB_METRICS !== '0') {
      const rows = Array.isArray(result) ? result : result?.rows || [];
      console.log(JSON.stringify({ type: 'db_transfer', at: new Date().toISOString(),
        flow, query: queryFingerprint(query), ok, duration_ms: Date.now() - start,
        rows: rows.length, payload_bytes: new TextEncoder().encode(JSON.stringify(result ?? null)).byteLength }));
    }
  }
}
