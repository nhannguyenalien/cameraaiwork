import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScene, parseScene, runSceneCheck, sceneAllowance } from "../functions/_lib/sceneAnalysis.js";

const camera = { account_id: "a", site_id: "s", stream: "cam1", name: "Cổng", security_level: "high" };
const sceneText = JSON.stringify({ threat: 2, role: "suspicious", people: 1, carrying: "túi", behavior: "nhìn vào nhà", summary: "Một người lảng vảng trước cổng", opening: "Xin chào, anh cần gì ạ?" });

function makeEnv({ recent = false, todayCount = 0, gemini = true, openai = false, plan = "pro", platformUsed = 0, customerGemini = false } = {}) {
  const log = { updates: [], queries: [] };
  const env = { SCENE_ANALYSIS_DAILY_CAP: "5" };
  if (gemini) env.GEMINI_API_KEY = "g-key";
  if (openai) env.OPENAI_API_KEY = "o-key";
  env.DB_CLIENT = { unsafe: async (sql, args) => {
    log.queries.push(sql);
    if (sql.includes("SELECT encrypted_config")) return customerGemini && args[1] === "gemini" ? [{ encrypted_config: customerGemini }] : [];
    if (sql.includes("FROM accounts")) return [{ plan, subscription_status: plan === "pro" ? "active" : "inactive" }];
    if (sql.includes("scene_json LIKE")) return [{ n: platformUsed }];
    if (sql.includes("LIMIT 1")) return recent ? [{ "?column?": 1 }] : [];
    if (sql.includes("COUNT(*)")) return [{ n: todayCount }];
    if (sql.includes("UPDATE events")) { log.updates.push({ sql, args }); return []; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  return { env, log };
}

test("parseScene tolerates code fences and clamps/sanitises fields", () => {
  const scene = parseScene("```json\n" + JSON.stringify({ threat: 9, role: "wizard", people: -3, summary: "x".repeat(900) }) + "\n```");
  assert.equal(scene.threat, 3);
  assert.equal(scene.role, "unknown");
  assert.equal(scene.people, 0);
  assert.equal(scene.summary.length, 300);
  assert.equal(parseScene("không phải json"), null);
});

test("allowance: only high security, never named people, cooldown and daily cap", async () => {
  assert.deepEqual(await sceneAllowance(makeEnv().env, { ...camera, security_level: "normal" }), { allowed: false, reason: "not-high-security" });
  assert.deepEqual(await sceneAllowance(makeEnv().env, camera, { personLabel: "Bố" }), { allowed: false, reason: "known-person" });
  assert.deepEqual(await sceneAllowance(makeEnv({ recent: true }).env, camera), { allowed: false, reason: "cooldown" });
  assert.deepEqual(await sceneAllowance(makeEnv({ todayCount: 5 }).env, camera), { allowed: false, reason: "daily-cap" });
  assert.deepEqual(await sceneAllowance(makeEnv().env, camera), { allowed: true });
});

test("analyzeScene sends the frame to Gemini and falls back to OpenAI", async (t) => {
  const calls = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("generativelanguage")) {
      assert.match(init.body, /inline_data/);
      return new Response("quota", { status: 429 });
    }
    assert.match(init.body, /input_image/);
    return Response.json({ output_text: sceneText });
  });
  const { env } = makeEnv({ openai: true });
  const scene = await analyzeScene(env, "a", Buffer.from([0xff, 0xd8, 1]));
  assert.equal(scene.provider, "openai");
  assert.equal(scene.threat, 2);
  assert.equal(calls.length, 2);
});

test("runSceneCheck stores the result, calls the API once, and skips when gated", async (t) => {
  let apiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { apiCalls += 1; return Response.json({ candidates: [{ content: { parts: [{ text: sceneText }] } }] }); });
  const first = makeEnv();
  const result = await runSceneCheck(first.env, { camera, siteName: "Nhà", eventId: 7, frame: Buffer.from([1]), personLabel: null });
  assert.equal(result.scene.threat, 2);
  assert.equal(apiCalls, 1);
  const stored = first.log.updates.at(-1);
  assert.equal(stored.args[1], 2);
  assert.match(stored.args[0], /Một người lảng vảng/);

  const skipped = await runSceneCheck(makeEnv({ recent: true }).env, { camera, siteName: "Nhà", eventId: 8, frame: Buffer.from([1]) });
  assert.equal(skipped.skipped, "cooldown");
  assert.equal(apiCalls, 1); // no second external call
});

test("no provider configured: no external call and the cooldown claim is released", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("must not be called"); });
  const { env, log } = makeEnv({ gemini: false });
  const result = await runSceneCheck(env, { camera, siteName: "Nhà", eventId: 9, frame: Buffer.from([1]) });
  assert.equal(result.skipped, "no-provider-or-failed");
  assert.match(log.updates.at(-1).sql, /scene_json = NULL/);
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recentScene, sceneContext, summarize } from "../functions/_lib/gateVoice.js";

test("server entrypoint only imports from directories the Docker image copies", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  const shipped = new Set(["functions", "server", "public"]); // see Dockerfile COPY lines
  for (const [, spec] of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const top = path.relative(root, path.resolve(root, "server", spec)).split(path.sep)[0];
    assert.ok(shipped.has(top), `${spec} is outside the Docker image`);
  }
});

test("butler gets recent finished scene as context and summary mentions it", async () => {
  const scene = JSON.parse(sceneText);
  const make = (row) => ({ DB_CLIENT: { unsafe: async () => (row ? [{ scene_json: row }] : []) } });
  assert.equal((await recentScene(make(sceneText), camera)).threat, 2);
  assert.equal(await recentScene(make('{"pending":true}'), camera), null);
  assert.equal(await recentScene(make(null), camera), null);
  const context = sceneContext(scene);
  assert.match(context, /KHÔNG đọc nguyên văn/);
  assert.match(context, /nguy cơ 2\/3/);
  assert.equal(sceneContext(null), "");
  assert.match(summarize([{ who: "scene", text: "Một người lảng vảng" }, { who: "visitor", text: "giao hàng" }], false), /Khách nói: giao hàng Camera thấy: Một người lảng vảng/);
  assert.match(summarize([{ who: "scene", text: "Một người lảng vảng" }], false), /chưa nói gì rõ ràng\. Camera thấy/);
});

import { encryptConfig } from "../functions/_lib/integrations.js";

const bytes = Buffer.from([0xff, 0xd8, 1]);
const geminiOk = () => Response.json({ candidates: [{ content: { parts: [{ text: sceneText }] } }] });

test("Pro accounts use the platform key first and the scene is tagged source=platform", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push(init.headers["x-goog-api-key"]); return geminiOk(); });
  const scene = await analyzeScene(makeEnv({ plan: "pro" }).env, "a", bytes);
  assert.equal(scene.source, "platform");
  assert.deepEqual(calls, ["g-key"]);
});

test("Free accounts never use the platform key (only their own, if any)", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push(init.headers["x-goog-api-key"]); return geminiOk(); });
  assert.equal(await analyzeScene(makeEnv({ plan: "free" }).env, "a", bytes), null);
  assert.deepEqual(calls, []);
  const own = makeEnv({ plan: "free", gemini: false });
  own.env.CUSTOMER_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await encryptConfig(own.env, { apiKey: "own-key" });
  const withOwn = makeEnv({ plan: "free", customerGemini: encrypted });
  withOwn.env.CUSTOMER_SECRETS_KEY = own.env.CUSTOMER_SECRETS_KEY;
  const scene = await analyzeScene(withOwn.env, "a", bytes);
  assert.equal(scene.source, "customer");
  assert.deepEqual(calls, ["own-key"]);
});

test("when the platform call fails a Pro account falls back to its own key; the platform daily cap fails closed", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const key = init.headers["x-goog-api-key"]; calls.push(key);
    return key === "g-key" ? new Response("quota", { status: 429 }) : geminiOk();
  });
  const base = makeEnv({ plan: "pro" });
  base.env.CUSTOMER_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await encryptConfig(base.env, { apiKey: "own-key" });
  const env2 = makeEnv({ plan: "pro", customerGemini: encrypted });
  env2.env.CUSTOMER_SECRETS_KEY = base.env.CUSTOMER_SECRETS_KEY;
  const scene = await analyzeScene(env2.env, "a", bytes);
  assert.equal(scene.source, "customer");
  assert.deepEqual(calls, ["g-key", "own-key"]);

  calls.length = 0;
  assert.equal(await analyzeScene(makeEnv({ plan: "pro", platformUsed: 1500 }).env, "a", bytes), null, "cap reached: no platform call");
  assert.deepEqual(calls, []);
});
