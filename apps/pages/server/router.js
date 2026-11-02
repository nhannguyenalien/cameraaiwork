// File-based routing that mirrors Cloudflare Pages Functions: functions/api/**
// maps to /api/**, `[name]` is a path parameter, `index.js` serves the
// directory, and functions/_middleware.js wraps every request.
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function toRoute(root, file) {
  const parts = relative(root, file).slice(0, -3).split(sep);
  if (parts.at(-1) === "index") parts.pop();
  const names = [];
  const pattern = parts.map((part) => {
    const match = part.match(/^\[(.+)\]$/);
    if (match) { names.push(match[1]); return "([^/]+)"; }
    return part.replace(/[.*+?^${}()|\\]/g, "\\$&");
  });
  return { regex: new RegExp(`^/${pattern.join("/")}/?$`), names, specificity: parts.filter((p) => !p.startsWith("[")).length };
}

export async function loadRoutes(functionsDir) {
  const routes = [];
  let middleware;
  for (const file of await walk(functionsDir)) {
    const rel = relative(functionsDir, file);
    if (rel.startsWith(`_lib${sep}`)) continue;
    const mod = await import(pathToFileURL(file).href);
    if (rel === "_middleware.js") { middleware = mod.onRequest; continue; }
    if (rel.includes("_middleware")) continue;
    const handlers = {};
    for (const method of METHODS) handlers[method] = mod[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
    routes.push({ ...toRoute(functionsDir, file), onRequest: mod.onRequest, handlers });
  }
  routes.sort((a, b) => b.specificity - a.specificity);
  return { routes, middleware };
}

export function matchRoute(routes, pathname, method) {
  for (const route of routes) {
    const match = route.regex.exec(pathname);
    if (!match) continue;
    const handler = route.handlers[method] || (method === "HEAD" ? route.handlers.GET : undefined) || route.onRequest;
    if (!handler) continue;
    const params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
    return { handler, params };
  }
  return null;
}
