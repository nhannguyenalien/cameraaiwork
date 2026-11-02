// Static asset serving with Cloudflare Pages semantics: clean URLs
// (/camera -> camera.html, /camera.html -> 308 /camera, /privacy/ ->
// privacy/index.html), the `/*` block of public/_headers, and Range support.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8", ".sh": "text/x-shellscript; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".onnx": "application/octet-stream",
  ".gz": "application/gzip", ".sha256": "text/plain; charset=utf-8",
};

export async function loadHeaders(publicDir) {
  const headers = {};
  try {
    let inGlobal = false;
    for (const line of (await readFile(join(publicDir, "_headers"), "utf8")).split("\n")) {
      if (/^\S/.test(line)) inGlobal = line.trim() === "/*";
      else if (inGlobal && line.includes(":")) {
        const i = line.indexOf(":");
        headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
    }
  } catch { /* no _headers file */ }
  return headers;
}

async function fileAt(path) {
  try { const info = await stat(path); return info.isFile() ? info : null; } catch { return null; }
}

export function createStatic(publicDir, globalHeaders) {
  const root = normalize(publicDir) + sep;
  return async function serve(request) {
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) return null;
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
    if (/(^|\/)_(headers|redirects)$/.test(pathname)) return null;
    if (pathname.endsWith("/index.html")) return Response.redirect(new URL(pathname.slice(0, -10) || "/", url), 308);
    if (pathname.endsWith(".html") && pathname !== "/404.html") return Response.redirect(new URL(pathname.slice(0, -5), url), 308);
    const base = normalize(join(publicDir, pathname));
    if (!(base + sep).startsWith(root) && base !== normalize(publicDir)) return null;
    let file = null;
    let path = base;
    for (const candidate of [base, `${base}.html`, join(base, "index.html")]) {
      if (pathname.endsWith("/") && candidate !== join(base, "index.html")) continue;
      const info = await fileAt(candidate);
      if (info) { file = info; path = candidate; break; }
    }
    if (!file) return null;
    if (pathname.endsWith("/") === false && path === join(base, "index.html")) return Response.redirect(new URL(`${pathname}/`, url), 308);
    const headers = new Headers({ ...globalHeaders, "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Accept-Ranges": "bytes", "Last-Modified": file.mtime.toUTCString() });
    headers.set("ETag", `W/"${file.size}-${Math.floor(file.mtimeMs)}"`);
    if (request.headers.get("if-none-match") === headers.get("ETag")) return new Response(null, { status: 304, headers });
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
    let start = 0, end = file.size - 1, status = 200;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
      if (start > end || start >= file.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    if (request.method === "HEAD") return new Response(null, { status, headers });
    return new Response(Readable.toWeb(createReadStream(path, { start, end })), { status, headers });
  };
}
