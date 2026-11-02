// Node entrypoint that runs the Cloudflare Pages app (functions/ + public/)
// as a plain HTTP server, e.g. on Coolify. Config comes from process.env.
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createR2Bucket } from "./r2.js";
import { loadRoutes, matchRoute } from "./router.js";
import { createStatic, loadHeaders } from "./static.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3000);

const env = { ...process.env, DB_SHARED_POOL: "1" };
if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) env.EVENTS_BUCKET = createR2Bucket(env);
else console.warn("R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY not set: event media storage is disabled");

const { routes, middleware } = await loadRoutes(join(root, "functions"));
const serveStatic = createStatic(publicDir, await loadHeaders(publicDir));

async function handle(request) {
  const pending = [];
  const waitUntil = (promise) => { pending.push(Promise.resolve(promise).catch((error) => console.error("waitUntil", error))); };
  const url = new URL(request.url);
  const matched = url.pathname.startsWith("/api/") ? matchRoute(routes, url.pathname, request.method) : null;
  const context = { request, env, data: {}, params: matched?.params || {}, waitUntil, functionPath: url.pathname };
  const final = async () => {
    if (matched) return matched.handler(context);
    const asset = await serveStatic(request);
    if (asset) return asset;
    return url.pathname.startsWith("/api/")
      ? new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } })
      : new Response("Not found", { status: 404 });
  };
  context.next = async () => final();
  return middleware ? middleware(context) : final();
}

function toRequest(req) {
  const proto = req.headers["x-forwarded-proto"]?.split(",")[0] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  const init = { method: req.method, headers: req.headers };
  if (!["GET", "HEAD"].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = "half"; }
  return new Request(`${proto}://${host}${req.url}`, init);
}

createServer(async (req, res) => {
  try {
    const response = await handle(toRequest(req));
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = key === "set-cookie" ? response.headers.getSetCookie() : value; });
    res.writeHead(response.status, headers);
    if (!response.body) return res.end();
    Readable.fromWeb(response.body).on("error", () => res.destroy()).pipe(res);
    res.on("close", () => response.body.cancel().catch(() => {}));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}).listen(port, () => console.log(`cameraaiwork listening on :${port}`));
