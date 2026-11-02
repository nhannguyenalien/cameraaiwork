// Minimal stand-in for the Cloudflare R2 binding (EVENTS_BUCKET) over R2's
// S3-compatible API, reusing the SigV4 signer in functions/_lib/s3.js. It
// implements only what the app calls: put, get, head, delete, list.
import { s3Request } from "../functions/_lib/s3.js";

async function ok(response, action) {
  if (response.ok) return response;
  const detail = (await response.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  throw new Error(`R2 ${action} failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
const decode = (value) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function createR2Bucket(env) {
  const config = {
    endpoint: env.R2_ENDPOINT || `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: "auto",
    bucket: env.R2_BUCKET || "cameraaiwork-events",
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    forcePathStyle: true,
  };
  const meta = (headers, size) => ({ size, httpMetadata: { contentType: headers.get("content-type") || undefined } });

  return {
    async put(key, body, options = {}) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(await new Response(body).arrayBuffer());
      await ok(await s3Request(config, "PUT", key, { body: bytes, contentType: options.httpMetadata?.contentType }), "put");
    },
    async head(key) {
      const response = await s3Request(config, "HEAD", key);
      if (response.status === 404) return null;
      await ok(response, "head");
      return meta(response.headers, Number(response.headers.get("content-length") || 0));
    },
    async get(key, options = {}) {
      const range = options.range ? `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}` : undefined;
      const response = await s3Request(config, "GET", key, { range });
      if (response.status === 404) return null;
      await ok(response, "get");
      const total = Number((response.headers.get("content-range") || "").split("/")[1] || response.headers.get("content-length") || 0);
      return { body: response.body, ...meta(response.headers, total) };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        const response = await s3Request(config, "DELETE", key);
        if (response.status !== 404) await ok(response, "delete");
      }
    },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const response = await ok(await s3Request(config, "GET", "", {
        query: { "list-type": 2, prefix, "max-keys": limit, "continuation-token": cursor },
      }), "list");
      const xml = await response.text();
      const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => ({
        key: decode(tag(match[1], "Key") || ""),
        size: Number(tag(match[1], "Size") || 0),
      }));
      const truncated = tag(xml, "IsTruncated") === "true";
      return { objects, truncated, cursor: truncated ? decode(tag(xml, "NextContinuationToken") || "") : undefined };
    },
  };
}
