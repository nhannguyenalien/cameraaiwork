import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScene, parseScene, runSceneCheck, sceneAllowance } from "../functions/_lib/sceneAnalysis.js";

const camera = { account_id: "a", site_id: "s", stream: "cam1", name: "Cổng", security_level: "high" };
const sceneText = JSON.stringify({ threat: 2, role: "suspicious", people: 1, carrying: "túi", behavior: "nhìn vào nhà", summary: "Một người lảng vảng trước cổng", opening: "Xin chào, anh cần gì ạ?" });

function makeEnv({ recent = false, todayCount = 0, gemini = true, openai = false } = {}) {
  const log = { updates: [], queries: [] };
  const env = { SCENE_ANALYSIS_DAILY_CAP: "5" };
  if (gemini) env.GEMINI_API_KEY = "g-key";
  if (openai) env.OPENAI_API_KEY = "o-key";
  env.DB_CLIENT = { unsafe: async (sql, args) => {
    log.queries.push(sql);
    if (sql.includes("SELECT encrypted_config")) return [];
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
