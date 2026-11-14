import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db.js";
import { getIntegration } from "./integrations.js";
import { getObject, putObject, resolveStorageChain } from "./objectStorage.js";
import { sendVideoAlert } from "./telegram.js";
import { introText, sceneCue, synthesizeSpeech } from "./summaryNarration.js";

export const SUMMARY_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS daily_summaries (
    id BIGSERIAL PRIMARY KEY,
    account_id TEXT NOT NULL,
    day DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    video_key TEXT,
    storage_backend TEXT,
    clip_count INTEGER,
    event_count INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
  )`,
  "ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS narration TEXT",
  "ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS camera TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE daily_summaries DROP CONSTRAINT IF EXISTS daily_summaries_account_id_day_key",
  "CREATE UNIQUE INDEX IF NOT EXISTS daily_summaries_acct_day_cam ON daily_summaries (account_id, day, camera)",
];

const CLIP_SECONDS = 3.5;
const FADE = 0.4; // cross-dissolve length between consecutive scenes
const CHUNK = 12; // clips per xfade pass (keeps open inputs / memory small)
const targetSeconds = () => Math.min(300, Math.max(30, Number(process.env.DAILY_SUMMARY_SECONDS) || 180));
const CLUSTER_MS = 2 * 60_000;
const TZ = () => process.env.DAILY_SUMMARY_TZ || "Asia/Ho_Chi_Minh";

// Pure rule-based selection (no AI): score, de-duplicate bursts across cameras,
// cap per camera, then spread over the day and return in time order.
export function scoreEvent(event) {
  let score = 1;
  const threat = Number(event.threat_level) || 0;
  score += threat * 3;
  if (!event.person_id && Number(event.people_count) === 0) score += 0; // motion only
  if (Number(event.people_count) > 0 && !event.person_id) score += 3; // person seen, not a known face
  if (Number(event.people_count) > 1) score += 1;
  return score;
}

export function selectClips(events, { targetClips = Math.floor(targetSeconds() / CLIP_SECONDS), perCamera } = {}) {
  const all = events.map((e) => ({ ...e, ms: new Date(e.timestamp).getTime(), score: scoreEvent(e) })).sort((a, b) => a.ms - b.ms);
  // High-security alerts (threat >= 2) are never merged away by the burst de-duplication.
  const alerts = all.filter((e) => Number(e.threat_level) >= 2);
  const rows = all.filter((e) => !(Number(e.threat_level) >= 2));
  // 1) burst clusters: keep the best event per ~3 minute window
  const clusters = [];
  for (const row of rows) {
    const last = clusters.at(-1);
    if (last && row.ms - last.end <= CLUSTER_MS) { last.end = row.ms; if (row.score > last.best.score) last.best = row; }
    else clusters.push({ end: row.ms, best: row });
  }
  let picks = [...clusters.map((c) => c.best), ...alerts];
  // 2) per-camera cap so one noisy camera cannot own the video
  const cameras = new Set(picks.map((p) => p.camera)).size || 1;
  const cap = perCamera || Math.max(2, Math.ceil((targetClips / cameras) * 1.5));
  const used = new Map();
  picks = picks.sort((a, b) => b.score - a.score || a.ms - b.ms).filter((p) => {
    const n = used.get(p.camera) || 0;
    if (n >= cap) return false;
    used.set(p.camera, n + 1);
    return true;
  });
  // 3) spread across the day: split into time buckets, take best of each, fill by score
  if (picks.length > targetClips) {
    const sorted = [...picks].sort((a, b) => a.ms - b.ms);
    const span = Math.max(1, sorted.at(-1).ms - sorted[0].ms + 1);
    const bucketCount = targetClips;
    const chosen = new Set();
    for (let b = 0; b < bucketCount; b += 1) {
      const lo = sorted[0].ms + (span * b) / bucketCount;
      const hi = sorted[0].ms + (span * (b + 1)) / bucketCount;
      const best = sorted.filter((p) => p.ms >= lo && p.ms < hi).sort((a, c) => c.score - a.score)[0];
      if (best) chosen.add(best);
    }
    for (const p of picks) { if (chosen.size >= targetClips) break; chosen.add(p); }
    picks = [...chosen];
  }
  return picks.slice(0, targetClips).sort((a, b) => a.ms - b.ms);
}

function run(cmd, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-400)}`)); });
  });
}

function label(event) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ(), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.timestamp));
  return `${time}  ${String(event.camera_name || event.camera || "").replace(/[^\p{L}\p{N}\- ]/gu, "")}`.trim();
}

// Cut CLIP_SECONDS from the middle of each clip, normalise to 720p/25fps
// h264 (no audio) and concatenate. Clips that fail to download/convert are
// skipped. Returns the mp4 bytes and how many clips were used.
function minuteOfDay(timestamp) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ(), hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(timestamp));
  return (Number(parts.find((p) => p.type === "hour").value) % 24) * 60 + Number(parts.find((p) => p.type === "minute").value);
}

// ffmpeg filters for the bottom timeline: one bar per hour sized by the number
// of events in that hour (ALL events of the day), a red marker at this clip's
// time, hour ticks, and "so far X/Y events" so the whole day is represented.
export function timelineFilters(clip, timeline) {
  if (!timeline?.hourly) return [];
  const W = 1280, H = 720, stripH = 76, y0 = H - stripH, bar = W / 24, maxBar = 44, base = H - 26;
  const max = Math.max(1, ...timeline.hourly);
  const peakHours = new Set([...timeline.hourly.keys()].sort((x, y) => timeline.hourly[y] - timeline.hourly[x]).slice(0, 3).filter((h) => timeline.hourly[h] > 0));
  const filters = [`drawbox=x=0:y=${y0}:w=${W}:h=${stripH}:color=black@0.78:t=fill`, `drawbox=x=0:y=${y0}:w=${W}:h=2:color=white@0.5:t=fill`];
  timeline.hourly.forEach((count, hour) => {
    if (!count) return;
    const h = Math.max(3, Math.round((count / max) * maxBar));
    filters.push(`drawbox=x=${Math.round(hour * bar + 3)}:y=${base - h}:w=${Math.round(bar - 6)}:h=${h}:color=${peakHours.has(hour) ? "0xFFC83D@1" : "white@0.9"}:t=fill`);
  });
  const x = Math.min(W - 6, Math.round((minuteOfDay(clip.timestamp) / 1440) * W));
  filters.push(`drawbox=x=${x}:y=${y0}:w=6:h=${stripH}:color=0xFF2D2D@1:t=fill`);
  for (const hour of [0, 3, 6, 9, 12, 15, 18, 21]) filters.push(`drawtext=text='${hour}h':x=${Math.round(hour * bar + 6)}:y=${H - 22}:fontsize=18:fontcolor=white:borderw=2:bordercolor=black@0.8`);
  if (timeline.allMs?.length) {
    const sofar = timeline.allMs.filter((ms) => ms <= new Date(clip.timestamp).getTime()).length;
    filters.push(`drawtext=text='${sofar}/${timeline.allMs.length} sự kiện':x=w-tw-24:y=${y0 - 50}:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8`);
  }
  return filters;
}

export async function renderSummary(env, accountId, clips, { fetchClip = downloadClip, timeline } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "daysum-"));
  try {
    const parts = [];
    for (const clip of clips) {
      try {
        const src = join(dir, `src-${clip.id}.mp4`);
        await writeFile(src, await fetchClip(env, accountId, clip));
        const out = join(dir, `part-${parts.length}.mp4`);
        const text = label(clip).replace(/:/g, "\\:");
        await run("ffmpeg", ["-y", "-ss", "2", "-i", src, "-t", String(CLIP_SECONDS + FADE), "-an",
          "-vf", `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25,drawtext=text='${text}':x=24:y=h-${timeline?.hourly ? 126 : 48}:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8${["", ...timelineFilters(clip, timeline)].join(",")},format=yuv420p`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", out]);
        await rm(src, { force: true });
        const duration = await probeDuration(out);
        if (duration < FADE * 3) throw new Error("clip too short");
        parts.push({ file: out, duration, clip });
      } catch (error) {
        console.error(`[daily-summary] clip ${clip.id} skipped:`, error.message || error);
      }
    }
    if (!parts.length) throw new Error("Không có clip nào dùng được");
    let level = parts;
    let pass = 0;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += CHUNK) {
        const group = level.slice(i, i + CHUNK);
        if (group.length === 1) { next.push(group[0]); continue; }
        const out = join(dir, `join-${pass}-${i}.mp4`);
        await xfadeJoin(group, out, level.length <= CHUNK);
        next.push({ file: out, duration: group.reduce((sum, g) => sum + g.duration, 0) - (group.length - 1) * FADE });
      }
      level = next;
      pass += 1;
    }
    const final = join(dir, "final.mp4");
    await run("ffmpeg", ["-y", "-i", level[0].file, "-c", "copy", "-movflags", "+faststart", final]);
    return { bytes: await readFile(final), used: parts.length, usedClips: parts.map((p) => p.clip) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Cross-dissolve consecutive clips directly into the next picture (no black).
// offset_k = (d_0 + ... + d_{k-1}) - k * FADE.
async function xfadeJoin(group, out, last) {
  const inputs = group.flatMap((g) => ["-i", g.file]);
  const chain = [];
  let acc = group[0].duration;
  let prev = "[0:v]";
  for (let k = 1; k < group.length; k += 1) {
    const label = k === group.length - 1 ? "[v]" : `[x${k}]`;
    chain.push(`${prev}[${k}:v]xfade=transition=fade:duration=${FADE}:offset=${(acc - k * FADE).toFixed(3)}${label}`);
    acc += group[k].duration;
    prev = label;
  }
  await run("ffmpeg", ["-y", ...inputs, "-filter_complex", chain.join(";"), "-map", "[v]", "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", last ? "26" : "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { timeoutMs: 300_000 });
}

async function downloadClip(env, accountId, clip) {
  const object = await getObject(env, accountId, clip.storage_backend || "r2", clip.video_key);
  if (!object) throw new Error("clip missing");
  return Buffer.from(await new Response(object.body).arrayBuffer());
}

function probeDuration(path) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", () => resolve(0));
    child.on("close", () => resolve(Number(out.trim()) || 0));
  });
}

// Lay the voice-over on the finished video. The shorter track is padded
// (frozen last frame / silence) so neither is cut off.
// Voice cues: [{at: seconds, speech: {bytes, format}}]. Each cue starts at its
// scene (or right after the previous cue ends, never overlapping); the video is
// extended with a frozen last frame only if speech runs past its end.
export async function mixCues(videoBytes, cues) {
  const dir = await mkdtemp(join(tmpdir(), "daymix-"));
  try {
    const video = join(dir, "v.mp4");
    const out = join(dir, "out.mp4");
    await writeFile(video, videoBytes);
    const wavs = [];
    for (const [i, cue] of cues.entries()) {
      const audio = join(dir, `a${i}.${cue.speech.format}`);
      await writeFile(audio, cue.speech.bytes);
      const input = cue.speech.format === "pcm" ? ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", audio] : ["-i", audio];
      const wav = join(dir, `n${i}.wav`);
      await run("ffmpeg", ["-y", ...input, "-ar", "44100", "-ac", "1", wav]);
      wavs.push({ wav, duration: await probeDuration(wav), at: cue.at });
    }
    let cursor = 0;
    for (const w of wavs) { w.start = Math.max(w.at, cursor); cursor = w.start + w.duration + 0.3; }
    const vd = await probeDuration(video);
    const speechEnd = wavs.length ? wavs.at(-1).start + wavs.at(-1).duration : 0;
    const extra = Math.max(0, speechEnd - vd + 0.5);
    const total = Math.max(vd, speechEnd + 0.5);
    const delays = wavs.map((w, i) => `[${i + 1}:a]adelay=${Math.round(w.start * 1000)}|${Math.round(w.start * 1000)}[a${i}]`);
    const mixIn = wavs.map((_, i) => `[a${i}]`).join("");
    const graph = [...delays, wavs.length > 1 ? `${mixIn}amix=inputs=${wavs.length}:normalize=0:duration=longest,apad[aout]` : `${mixIn}apad[aout]`].join(";");
    await run("ffmpeg", ["-y", "-i", video, ...wavs.flatMap((w) => ["-i", w.wav]), "-filter_complex", graph,
      ...(extra > 0 ? ["-vf", `tpad=stop_mode=clone:stop_duration=${extra.toFixed(2)}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p"] : ["-c:v", "copy"]),
      "-c:a", "aac", "-b:a", "96k", "-t", total.toFixed(2), "-map", "0:v:0", "-map", "[aout]", "-movflags", "+faststart", out], { timeoutMs: 180_000 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const mixNarration = (videoBytes, speech) => mixCues(videoBytes, [{ at: 0, speech }]);

// Events per local hour over the WHOLE day (not only the chosen clips), so the
// voice-over can describe the day's rhythm even though the video is a highlight reel.
export function hourlyCounts(events) {
  const counts = new Array(24).fill(0);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ(), hour: "2-digit", hour12: false });
  for (const event of events) counts[Number(fmt.format(new Date(event.timestamp))) % 24] += 1;
  return counts;
}

export function yesterday(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(now.getTime() - 24 * 3600_000));
}

async function dayEvents(db, accountId, day, camera = "") {
  const result = await db.execute({
    sql: `SELECT e.id, e.camera, COALESCE(NULLIF(c.name, ''), e.camera) AS camera_name, e.timestamp, e.person_id, e.threat_level, e.scene_json, e.video_key, e.storage_backend,
                 (SELECT COUNT(*) FROM event_people p WHERE p.event_id = e.id) AS people_count
          FROM events e LEFT JOIN cameras c ON c.id = e.camera AND c.account_id = e.account_id
          WHERE e.account_id = ? AND e.video_key IS NOT NULL AND e.video_status = 'ready'
            AND (e.timestamp AT TIME ZONE ?)::date = ?::date
            AND (?::text = '' OR e.camera = ?::text)
          ORDER BY e.timestamp ASC`,
    args: [accountId, TZ(), day, camera, camera],
  });
  return result.rows;
}

// Build (or rebuild) one account's summary for `day` (YYYY-MM-DD).
// camera = "" -> whole system; otherwise one camera id (shorter reel).
export async function generateDailySummary(env, accountId, day, deps = {}, camera = "") {
  const db = getDb(env, "_lib.dailySummary");
  await db.execute({
    sql: `INSERT INTO daily_summaries (account_id, day, camera, status) VALUES (?, ?::date, ?, 'running')
          ON CONFLICT (account_id, day, camera) DO UPDATE SET status = 'running', error = NULL, created_at = CURRENT_TIMESTAMP`,
    args: [accountId, day, camera],
  });
  try {
    const events = await dayEvents(db, accountId, day, camera);
    const cameraName = camera ? (events[0]?.camera_name || camera) : "";
    const seconds = camera ? Math.min(300, Math.max(30, Number(process.env.DAILY_SUMMARY_CAMERA_SECONDS) || 90)) : undefined;
    const clips = selectClips(events, camera ? { targetClips: Math.floor(seconds / CLIP_SECONDS), perCamera: Infinity } : {});
    if (!clips.length) {
      await db.execute({ sql: "UPDATE daily_summaries SET status = 'empty', event_count = 0, clip_count = 0, finished_at = CURRENT_TIMESTAMP WHERE account_id = ? AND day = ?::date AND camera = ?", args: [accountId, day, camera] });
      return { status: "empty" };
    }
    let { bytes, used, usedClips = clips } = await (deps.render || renderSummary)(env, accountId, clips, { timeline: { hourly: hourlyCounts(events), allMs: events.map((e) => new Date(e.timestamp).getTime()).sort((a, b) => a - b) } });
    // Voice: a short general intro, plus one line per scene that the high-security
    // analysis already described. No AI call here, nothing is guessed from frames.
    const cueTexts = [];
    usedClips.forEach((clip, i) => { const text = sceneCue(clip, TZ()); if (text) cueTexts.push({ at: i * CLIP_SECONDS, text }); });
    const intro = introText({ day, totalEvents: events.length, hourly: hourlyCounts(events), cameraName, alerts: cueTexts.length });
    let narration = intro;
    if (cueTexts.length) narration += "\n" + cueTexts.map((c) => c.text).join("\n");
    if (env.DAILY_SUMMARY_VOICE !== "off") {
      try {
        const cues = [];
        for (const item of [{ at: 0, text: intro }, ...cueTexts]) {
          const speech = await (deps.speech || synthesizeSpeech)(env, accountId, item.text);
          if (speech) cues.push({ at: item.at, speech });
        }
        if (cues.length) bytes = await (deps.mix || mixCues)(bytes, cues);
      } catch (error) { console.error("[daily-summary] voice skipped:", error.message || error); }
    }
    const key = `${accountId}/summaries/${day}${camera ? `-${camera}` : ""}.mp4`;
    let backend;
    let lastError;
    for (const candidate of await resolveStorageChain(env, accountId)) {
      try { await putObject(env, accountId, candidate, key, bytes, "video/mp4"); backend = candidate; break; }
      catch (error) { lastError = error; }
    }
    if (!backend) throw lastError || new Error("Không lưu được video tóm tắt");
    await db.execute({
      sql: "UPDATE daily_summaries SET status = 'ready', video_key = ?, storage_backend = ?, clip_count = ?, event_count = ?, narration = ?, finished_at = CURRENT_TIMESTAMP WHERE account_id = ? AND day = ?::date AND camera = ?",
      args: [key, backend, used, events.length, narration, accountId, day, camera],
    });
    const telegram = await getIntegration(env, accountId, "telegram").catch(() => null);
    if (telegram && bytes.length < 49 * 1024 * 1024) {
      await (deps.sendVideo || sendVideoAlert)(telegram, bytes, narration.slice(0, 1000)).catch((e) => console.error("[daily-summary] telegram", e.message || e));
    }
    return { status: "ready", clips: used, events: events.length, key, backend };
  } catch (error) {
    await db.execute({ sql: "UPDATE daily_summaries SET status = 'error', error = ?, finished_at = CURRENT_TIMESTAMP WHERE account_id = ? AND day = ?::date AND camera = ?", args: [String(error.message || error).slice(0, 300), accountId, day, camera] });
    throw error;
  }
}

// Nightly job: accounts with video yesterday and no finished summary, one at a time.
export async function runDailySummaries(env, now = new Date(), deps = {}) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ(), hour: "2-digit", hour12: false }).format(now));
  if (!deps.force && hour !== Number(process.env.DAILY_SUMMARY_HOUR || 2)) return { skipped: true };
  const day = yesterday(now);
  const db = getDb(env, "_lib.dailySummary");
  const accounts = await db.execute({
    sql: `SELECT DISTINCT e.account_id FROM events e
          WHERE e.video_key IS NOT NULL AND (e.timestamp AT TIME ZONE ?)::date = ?::date
            AND NOT EXISTS (SELECT 1 FROM daily_summaries s WHERE s.account_id = e.account_id AND s.camera = '' AND s.day = ?::date AND s.status IN ('ready','empty','running'))`,
    args: [TZ(), day, day],
  });
  const results = [];
  for (const row of accounts.rows) {
    try { results.push({ accountId: row.account_id, ...(await generateDailySummary(env, row.account_id, day, deps)) }); }
    catch (error) { results.push({ accountId: row.account_id, status: "error", error: String(error.message || error) }); }
  }
  return { day, results };
}
