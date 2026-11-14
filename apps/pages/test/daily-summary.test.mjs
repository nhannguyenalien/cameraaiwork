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
