const test = require("node:test");
const assert = require("node:assert/strict");
const { createVoiceGuard, detectUtterance } = require("../src/voice-guard");

const SR = 16000;
const frameBytes = SR * 0.02 * 2;
function tone(ms, amp) {
  const n = SR * ms / 1000;
  const buffer = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 8) * amp), i * 2);
  return buffer;
}
async function* feed(...parts) { for (const part of parts) for (let i = 0; i < part.length; i += frameBytes * 5) yield part.subarray(i, i + frameBytes * 5); }

test("detectUtterance returns speech with pre-roll and stops after silence", async () => {
  const pcm = await detectUtterance(feed(tone(500, 40), tone(1200, 6000), tone(2000, 40)));
  assert.ok(pcm);
  const ms = pcm.length / 2 / SR * 1000;
  assert.ok(ms > 1200 && ms < 3200, `utterance length ${ms}`);
});

test("detectUtterance gives up when nobody speaks", async () => {
  assert.equal(await detectUtterance(feed(tone(8000, 40))), null);
});

test("detectUtterance caps a never-ending utterance", async () => {
  const pcm = await detectUtterance(feed(tone(500, 40), tone(20000, 6000)), { maxMs: 4000 });
  assert.ok(pcm.length / 2 / SR * 1000 <= 4300);
});

function makeGuard(overrides = {}) {
  const posts = [];
  const played = [];
  const http = {
    get: async () => ({ data: { cameras: { gate: { gateButler: true }, yard: { gateButler: false } } } }),
    post: async (url, body, options) => {
      const name = url.split("/").pop();
      posts.push({ name, params: options.params });
      if (name === "greeting") return { data: { audioBase64: Buffer.from("hello").toString("base64") } };
      if (name === "turn") return { data: { audioBase64: Buffer.from("reply").toString("base64"), done: posts.filter((p) => p.name === "turn").length >= 2 } };
      return { data: { ok: true } };
    },
  };
  const guard = createVoiceGuard({
    config: { motionWebhookUrl: "https://example.test/api/motion", relaySecret: "s", siteId: "site1", go2rtc: { rtspUrl: "rtsp://127.0.0.1:8554" } },
    play: async (camera, audio) => { played.push(audio.toString()); return true; },
    listen: async () => Buffer.alloc(3200),
    encode: async (pcm) => Buffer.from("webm"),
    http, log: { log() {}, warn() {}, error() {} }, settleMs: 0, ...overrides,
  });
  return { guard, posts, played };
}

test("a visit greets, listens, replies until done, then always finishes", async () => {
  const { guard, posts, played } = makeGuard();
  await guard.refreshPolicy();
  assert.equal(guard.enabled({ id: "gate" }), true);
  assert.equal(guard.enabled({ id: "yard" }), false);
  await guard.runVisit({ id: "gate" });
  assert.deepEqual(posts.map((p) => p.name), ["greeting", "turn", "turn", "finish"]);
  assert.deepEqual(played, ["hello", "reply", "reply"]);
  assert.ok(posts.every((p) => p.params.camera === "gate" && p.params.siteId === "site1" && p.params.visit === posts[0].params.visit));
});

test("silence ends the visit but still finishes it", async () => {
  const { guard, posts } = makeGuard({ listen: async () => null });
  await guard.refreshPolicy();
  await guard.runVisit({ id: "gate" });
  assert.deepEqual(posts.map((p) => p.name), ["greeting", "finish"]);
});

test("maybeStart respects policy, active visit and cooldown", async () => {
  const { guard } = makeGuard({ visitCooldownMs: 60000 });
  await guard.refreshPolicy();
  assert.equal(await guard.maybeStart({ id: "yard" }), false);
  assert.equal(await guard.maybeStart({ id: "gate" }), true);
  assert.equal(await guard.maybeStart({ id: "gate" }), false, "second trigger within cooldown");
});

test("a failing greeting does not throw out of the visit and still finishes", async () => {
  const { guard, posts } = makeGuard({ http: {
    get: async () => ({ data: { cameras: { gate: { gateButler: true } } } }),
    post: async (url, _body, options) => { posts2.push(url.split("/").pop()); if (url.endsWith("greeting")) throw new Error("boom"); return { data: {} }; },
  } });
  const posts2 = [];
  await guard.refreshPolicy();
  await assert.rejects(guard.runVisit({ id: "gate" }), /boom/);
  assert.deepEqual(posts2, ["greeting", "finish"]);
});
