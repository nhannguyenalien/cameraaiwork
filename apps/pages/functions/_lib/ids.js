// IMPORTANT: no ":" (or anything else that isn't URL-path-safe) in
// generated ids — they get used as path segments (PATCH /api/sites/:id,
// /api/cameras/:site/:camera/ptz, GET /api/jobs/:id) and Cloudflare Pages
// Functions' router mis-routes segments containing a colon. Account
// scoping comes from the account_id column, not from parsing structure
// out of the id string, so there's no need to embed it in the id anyway.
export function randomId(prefix, len = 12) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, len)}`;
}

export function randomSecret() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
