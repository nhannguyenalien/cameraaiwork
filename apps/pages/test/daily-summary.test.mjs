import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { selectClips, renderSummary } from "../functions/_lib/dailySummary.js";

const T0 = Date.parse("2026-11-13T00:00:00Z");
const ev = (id, minutes, camera, extra = {}) => ({ id, camera, timestamp: new Date(T0 + minutes * 60_000).toISOString(), ...extra });

test("bursts across cameras collapse to the best event", () => {
  const picked = selectClips([ev(1, 0, "a"), ev(2, 1, "b", { threat_level: 3 }), ev(3, 2, "c"), ev(4, 60, "a")], { targetClips: 10 });
  assert.deepEqual(picked.map((p) => p.id), [2, 4]);
});

test("unknown person beats plain motion; result is capped and in time order", () => {
  const events = [];
  for (let i = 0; i < 100; i += 1) events.push(ev(i, i * 10, `cam${i % 4}`, i % 7 === 0 ? { people_count: 1 } : {}));
  const picked = selectClips(events, { targetClips: 20 });
  assert.equal(picked.length, 20);
  assert.deepEqual(picked.map((p) => p.ms), [...picked.map((p) => p.ms)].sort((a, b) => a - b));
  assert.ok(picked.filter((p) => p.people_count === 1).length >= 10);
});

test("per-camera cap keeps one noisy camera from owning the video", () => {
  const events = [];
  for (let i = 0; i < 40; i += 1) events.push(ev(i, i * 10, "noisy", { threat_level: 2 }));
  events.push(ev(100, 5, "quiet"), ev(101, 205, "quiet"));
  const picked = selectClips(events, { targetClips: 10, perCamera: 4 });
  assert.equal(picked.filter((p) => p.camera === "noisy").length, 4);
  assert.equal(picked.filter((p) => p.camera === "quiet").length, 2);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("renderSummary joins clips with ffmpeg and skips unreadable ones", { skip: !hasFfmpeg }, async (t) => {
  t.mock.method(console, "error", () => {});
  const sample = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=15:duration=8", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"], { maxBuffer: 50e6 }).stdout;
  assert.ok(sample.length > 1000);
  const clips = [ev(1, 0, "cam1"), ev(2, 10, "cam2"), ev(3, 20, "cam3")];
  const { bytes, used } = await renderSummary({}, "a", clips, { fetchClip: async (_e, _a, clip) => { if (clip.id === 2) throw new Error("gone"); return sample; } });
  assert.equal(used, 2);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "-i", "pipe:0"], { input: bytes });
  const duration = Number(String(probe.stdout).trim());
  assert.ok(duration > 7 && duration < 9, `duration ${duration}`);
});

import { generateDailySummary, runDailySummaries } from "../functions/_lib/dailySummary.js";

function flowEnv(rows) {
  const log = [];
  const unsafe = async (sql, args) => {
    log.push(sql.replace(/\s+/g, " ").slice(0, 40));
    if (sql.includes("FROM events e") && sql.includes("people_count")) return rows;
    if (sql.includes("SELECT DISTINCT e.account_id")) return [{ account_id: "a" }];
    return [];
  };
  return { log, env: { DB_CLIENT: { unsafe, begin: async (fn) => Promise.all(fn({ unsafe })) } } };
}

test("generateDailySummary: empty day is marked empty without rendering", async () => {
  const { env, log } = flowEnv([]);
  const result = await generateDailySummary(env, "a", "2026-11-13", { render: async () => { throw new Error("must not render"); } });
  assert.equal(result.status, "empty");
  assert.ok(log.some((l) => l.includes("INSERT INTO daily_summaries")));
});

test("runDailySummaries only fires at the configured local hour unless forced", async () => {
  const { env } = flowEnv([]);
  const noon = new Date("2026-11-13T05:00:00Z"); // 12:00 Asia/Ho_Chi_Minh
  assert.deepEqual(await runDailySummaries(env, noon), { skipped: true });
  const forced = await runDailySummaries(env, noon, { force: true, render: async () => { throw new Error("no clips expected"); } });
  assert.equal(forced.results[0].status, "empty");
});

import { narrationFacts, templateNarration, writeNarration, synthesizeSpeech, splitForTts } from "../functions/_lib/summaryNarration.js";
import { mixNarration } from "../functions/_lib/dailySummary.js";

test("narration facts use stored scene summary and never invent identities", () => {
  const facts = narrationFacts([
    ev(1, 0, "cong", { scene_json: JSON.stringify({ summary: "Shipper đưa kiện hàng", threat: 0 }), threat_level: 0 }),
    ev(2, 30, "san", { people_count: 1 }),
    ev(3, 60, "sau", { threat_level: 3, scene_json: '{"pending":true}' }),
  ], "UTC");
  assert.deepEqual(facts.map((f) => f.text), ["Shipper đưa kiện hàng", "có người lạ xuất hiện", "có chuyển động"]);
  assert.match(templateNarration("2026-11-13", 3, facts), /Tóm tắt ngày 2026-11-13\. Hệ thống ghi nhận 3 sự kiện\./);
});

test("writeNarration falls back to the template without AI keys or when the API fails", async (t) => {
  t.mock.method(console, "error", () => {});
  const args = { day: "2026-11-13", totalEvents: 3, facts: [{ time: "08:00", camera: "cong", text: "có người lạ", threat: 1 }], tz: "UTC" };
  assert.equal((await writeNarration({}, "a", args, { credentials: async () => ({}) })).source, "template");
  t.mock.method(globalThis, "fetch", async () => new Response("no", { status: 500 }));
  assert.equal((await writeNarration({}, "a", args, { credentials: async () => ({ gemini: { apiKey: "k" } }) })).source, "template");
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [{ content: { parts: [{ text: "Hôm nay có ba sự kiện, đáng chú ý nhất là lúc tám giờ ở cổng." }] } }] }));
  const ok = await writeNarration({}, "a", args, { credentials: async () => ({ gemini: { apiKey: "k" } }) });
  assert.equal(ok.source, "ai");
});

test("synthesizeSpeech tries providers in order, skips failures, null when all fail", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];
  const mk = (name, ok) => async () => { calls.push(name); if (!ok) throw new Error("down"); return { bytes: Buffer.from(name), format: "mp3" }; };
  const providers = { edge: mk("edge", false), gtts: mk("gtts", true), piper: mk("piper", true) };
  const r = await synthesizeSpeech({}, "a", "xin chào", { providers });
  assert.equal(r.provider, "gtts");
  assert.deepEqual(calls, ["edge", "gtts"]);
  const none = await synthesizeSpeech({ DAILY_SUMMARY_TTS: "edge,piper" }, "a", "x", { providers: { edge: mk("e", false), piper: mk("p", false) } });
  assert.equal(none, null);
  const order = [];
  await synthesizeSpeech({ DAILY_SUMMARY_TTS: "piper,edge" }, "a", "x", { providers: { piper: async () => { order.push("piper"); return { bytes: Buffer.alloc(1), format: "wav" }; }, edge: mk("edge", true) } });
  assert.deepEqual(order, ["piper"]);
});

test("splitForTts keeps every piece within the limit at sentence/word boundaries", () => {
  const text = "Câu thứ nhất khá dài " + "từ ".repeat(80) + "kết thúc. Câu hai ngắn.";
  const pieces = splitForTts(text, 100);
  assert.ok(pieces.every((p) => p.length <= 100));
  assert.equal(pieces.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("piper provider is skipped cleanly when the model file is missing", async (t) => {
  t.mock.method(console, "error", () => {});
  assert.equal(await synthesizeSpeech({ DAILY_SUMMARY_TTS: "piper", PIPER_MODEL: "/nonexistent/model.onnx" }, "a", "x"), null);
});

test("live Edge TTS returns mp3 that mixNarration can use (skipped offline)", { skip: !hasFfmpeg || process.env.SKIP_NETWORK_TESTS }, async (t) => {
  t.mock.method(console, "error", () => {});
  const speech = await synthesizeSpeech({ DAILY_SUMMARY_TTS: "edge,gtts" }, "a", "Xin chào, đây là bản tóm tắt ngày hôm nay.");
  if (!speech) return t.skip("no network");
  assert.equal(speech.format, "mp3");
  const video = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=1", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"], { maxBuffer: 50e6 }).stdout;
  const mixed = await mixNarration(video, speech);
  assert.ok(mixed.length > 1000);
});

test("mixNarration adds an audio track and extends video when speech is longer", { skip: !hasFfmpeg }, async () => {
  const video = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=2", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"], { maxBuffer: 50e6 }).stdout;
  const pcm = Buffer.alloc(24000 * 2 * 4); // 4s of silence, s16le 24k mono
  const mixed = await mixNarration(video, { bytes: pcm, format: "pcm" });
  const probe = (args) => String(spawnSync("ffprobe", ["-v", "error", ...args, "-of", "csv=p=0", "-i", "pipe:0"], { input: mixed }).stdout).trim();
  assert.match(probe(["-select_streams", "a", "-show_entries", "stream=codec_name"]), /aac/);
  const duration = Number(probe(["-show_entries", "format=duration"]));
  assert.ok(duration >= 4 && duration < 5.5, `duration ${duration}`);
});
