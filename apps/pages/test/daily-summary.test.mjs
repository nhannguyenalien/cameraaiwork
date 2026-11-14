import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { selectClips, renderSummary } from "../functions/_lib/dailySummary.js";

const T0 = Date.parse("2026-11-13T00:00:00Z");
const ev = (id, minutes, camera, extra = {}) => ({ id, camera, timestamp: new Date(T0 + minutes * 60_000).toISOString(), ...extra });

test("bursts across cameras collapse to the best event", () => {
  const picked = selectClips([ev(1, 0, "a"), ev(2, 1, "b", { threat_level: 3 }), ev(3, 2, "c"), ev(4, 60, "a")], { targetClips: 10 });
  assert.deepEqual(picked.map((p) => p.id), [1, 2, 4]); // 1 & 3 merge (2 min apart); the alert is always kept
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
  const hourly = new Array(24).fill(0); hourly[0] = 5; hourly[7] = 20;
  const { bytes, used } = await renderSummary({}, "a", clips, { timeline: { hourly, allMs: clips.map((c) => Date.parse(c.timestamp)) }, fetchClip: async (_e, _a, clip) => { if (clip.id === 2) throw new Error("gone"); return sample; } });
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

import { introText, sceneCue, synthesizeSpeech, splitForTts } from "../functions/_lib/summaryNarration.js";
import { mixNarration, mixCues } from "../functions/_lib/dailySummary.js";

test("voice speaks only the general intro and scenes already analysed by high security", () => {
  assert.equal(sceneCue(ev(1, 0, "cong", { people_count: 1 }), "UTC"), null);
  assert.equal(sceneCue(ev(2, 30, "cong", { scene_json: '{"pending":true}' }), "UTC"), null);
  const cue = sceneCue(ev(3, 60 * 7 + 23, "cong", { scene_json: JSON.stringify({ summary: "Người lạ đứng trước cổng", threat: 3 }) }), "UTC");
  assert.equal(cue, "07 giờ 23. Đáng ngờ. Người lạ đứng trước cổng");
  const hourly = new Array(24).fill(1); hourly[15] = 50; hourly[16] = 40; hourly[17] = 30;
  assert.equal(introText({ day: "2026-11-13", totalEvents: 639, hourly, alerts: 2 }), "Tóm tắt ngày 2026-11-13. 639 sự kiện. Cao điểm từ 15 đến 18 giờ. Có 2 cảnh cần chú ý.");
  assert.match(introText({ day: "d", totalEvents: 5, hourly: new Array(24).fill(0), cameraName: "Cổng" }), /camera Cổng\. 5 sự kiện\.$/);
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

import { peakWindow } from "../functions/_lib/summaryNarration.js";
import { hourlyCounts } from "../functions/_lib/dailySummary.js";

test("default target is ~3 minutes (51 clips) spread over the whole day", () => {
  const events = [];
  for (let i = 0; i < 640; i += 1) events.push(ev(i, Math.floor((i / 640) * 1400), `cam${i % 16}`, i % 9 === 0 ? { people_count: 1 } : {}));
  const picked = selectClips(events);
  assert.equal(picked.length, 51);
  const hours = new Set(picked.map((p) => Math.floor((p.ms - T0) / 3600_000)));
  assert.ok(hours.size >= 18, `only ${hours.size} distinct hours covered`);
});

test("peak window and hourly counts describe the whole day", () => {
  const hourly = new Array(24).fill(1); hourly[10] = 80; hourly[11] = 70; hourly[12] = 60;
  assert.deepEqual(peakWindow(hourly), { from: 10, to: 13, count: 210 });
  assert.equal(peakWindow(new Array(24).fill(0)), null);
  process.env.DAILY_SUMMARY_TZ = "UTC";
  const counts = hourlyCounts([ev(1, 0, "a"), ev(2, 10, "a"), ev(3, 130, "a")]);
  delete process.env.DAILY_SUMMARY_TZ;
  assert.deepEqual([counts[0], counts[2]], [2, 1]);
});

test("renderSummary cross-dissolves many clips across chunk levels with the exact net duration", { skip: !hasFfmpeg }, async () => {
  const sample = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=7", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"], { maxBuffer: 50e6 }).stdout;
  const clips = Array.from({ length: 26 }, (_, i) => ev(i + 1, i * 10, `cam${i}`));
  const { bytes, used } = await renderSummary({}, "a", clips, { fetchClip: async () => sample });
  assert.equal(used, 26);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "-i", "pipe:0"], { input: bytes });
  const duration = Number(String(probe.stdout).trim());
  // net = 26 * 3.5 + 0.4 (each clip contributes 3.5s, the last keeps its 0.4s tail)
  assert.ok(Math.abs(duration - 91.4) < 1, `duration ${duration}`);
});

test("per-camera summary filters by camera, uses a shorter reel and its own key", async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, camera: "cam-x", camera_name: "Cổng", timestamp: new Date(T0 + i * 20 * 60_000).toISOString(), video_key: `k${i}`, storage_backend: "r2", people_count: 0 }));
  const sqls = [];
  const unsafe = async (sql, args) => {
    sqls.push({ sql: sql.replace(/\s+/g, " "), args });
    if (sql.includes("FROM events e") && sql.includes("people_count")) return rows;
    return [];
  };
  const env = { DB_CLIENT: { unsafe, begin: async (fn) => Promise.all(fn({ unsafe })) }, DAILY_SUMMARY_VOICE: "off", EVENTS_BUCKET: { put: async () => {}, head: async () => null, list: async () => ({ objects: [], truncated: false }) } };
  let rendered;
  const result = await generateDailySummary(env, "a", "2026-11-13", { render: async (_e, _a, clips) => { rendered = clips; return { bytes: Buffer.from("v"), used: clips.length }; } }, "cam-x");
  assert.equal(result.status, "ready");
  assert.equal(rendered.length, 25); // 90s / 3.5s
  assert.match(result.key, /summaries\/2026-11-13-cam-x\.mp4$/);
  const select = sqls.find((q) => q.sql.includes("people_count"));
  assert.deepEqual(select.args.slice(-2), ["cam-x", "cam-x"]);
  assert.ok(sqls.some((q) => q.sql.includes("ON CONFLICT (account_id, day, camera)") && q.args.includes("cam-x")));
});

test("high-security alert events are never merged away by the burst de-duplication", () => {
  const picked = selectClips([ev(1, 0, "a"), ev(2, 1, "b", { threat_level: 3 }), ev(3, 2, "c", { threat_level: 3 }), ev(4, 3, "d")], { targetClips: 10 });
  assert.ok([2, 3].every((id) => picked.some((p) => p.id === id))); // both alerts kept
});

test("mixCues places scene cues at their time without overlapping and keeps the video length", { skip: !hasFfmpeg }, async () => {
  const video = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=20", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"], { maxBuffer: 50e6 }).stdout;
  const pcm = (s) => Buffer.alloc(24000 * 2 * s);
  const mixed = await mixCues(video, [{ at: 0, speech: { bytes: pcm(3), format: "pcm" } }, { at: 1, speech: { bytes: pcm(2), format: "pcm" } }, { at: 12, speech: { bytes: pcm(2), format: "pcm" } }]);
  const dur = Number(String(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "-i", "pipe:0"], { input: mixed }).stdout).trim());
  assert.ok(dur >= 19.5 && dur < 21, `duration ${dur}`);
  const a = String(spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", "-i", "pipe:0"], { input: mixed }).stdout);
  assert.match(a, /aac/);
});
