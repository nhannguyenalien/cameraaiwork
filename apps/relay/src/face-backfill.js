const axios = require("axios");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function cosineSimilarity(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa > 0 && bb > 0 ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

// Keep this aligned with the cloud identity threshold. A higher value here
// turns different video frames of the same face into separate people.
function addDistinct(target, embeddings, threshold = 0.30) {
  for (const item of embeddings || []) {
    const embedding = Array.isArray(item) ? item : item?.embedding;
    if (!Array.isArray(embedding) || !embedding.length) continue;
    if (!target.some((known) => known.embedding.length === embedding.length && cosineSimilarity(known.embedding, embedding) >= threshold)) {
      target.push({
        embedding,
        box: !Array.isArray(item) && Array.isArray(item?.box) && item.box.length === 4 ? item.box : null,
      });
    }
  }
}

function extractFrames(videoPath, outputPattern, seconds) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-vf", `fps=1/${seconds}`, "-q:v", "3", outputPattern]);
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg lỗi ${code}: ${stderr.trim()}`)));
  });
}

function createFaceBackfill(config, log = console) {
  let running = false;
  const base = `${config.pagesApiUrl}/api/face-backfill`;
  const headers = { "x-relay-secret": config.relaySecret };

  async function detect(jpeg) {
    const result = await axios.post(`${config.aiWorkerUrl}/detect`, jpeg, {
      headers: { "content-type": "image/jpeg" }, timeout: 30000,
    });
    return result.data?.faceEmbeddings || (result.data?.faceEmbedding ? [result.data.faceEmbedding] : []);
  }

  async function media(eventId, kind) {
    const result = await axios.get(base, {
      params: { action: "media", siteId: config.siteId, eventId, kind }, headers,
      responseType: "arraybuffer", timeout: kind === "video" ? 120000 : 30000,
      maxContentLength: 30 * 1024 * 1024,
    });
    return Buffer.from(result.data);
  }

  async function processEvent(event) {
    const found = [];
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cameraai-face-"));
    try {
      if (event.hasImage) addDistinct(found, await detect(await media(event.id, "image")));
      if (event.hasVideo) {
        const videoPath = path.join(temp, "event.mp4");
        await fs.writeFile(videoPath, await media(event.id, "video"));
        await extractFrames(videoPath, path.join(temp, "frame-%05d.jpg"), config.faceBackfillFrameIntervalSeconds);
        const frames = (await fs.readdir(temp)).filter((name) => name.endsWith(".jpg")).sort();
        // A box from a video frame cannot crop the event's still image. Keep
        // the embedding but deliberately discard that frame-local box.
        for (const frame of frames) {
          const faces = await detect(await fs.readFile(path.join(temp, frame)));
          addDistinct(found, faces.map((face) => Array.isArray(face) ? face : face?.embedding));
        }
      }
      await axios.post(base, { siteId: config.siteId, eventId: event.id, faceEmbeddings: found }, { headers, timeout: 60000 });
      log.log(`👤 Đã quét event R2 #${event.id}: ${found.length} khuôn mặt`);
    } catch (error) {
      const message = String(error.response?.data?.error || error.message || error).slice(0, 500);
      log.error(`❌ Quét khuôn mặt event #${event.id} lỗi: ${message}`);
      await axios.post(base, { siteId: config.siteId, eventId: event.id, error: message }, { headers, timeout: 15000 }).catch(() => {});
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  async function run() {
    if (running || !config.pagesApiUrl || !config.relaySecret || config.faceBackfillIntervalMs <= 0) return;
    running = true;
    try {
      const response = await axios.get(base, {
        params: { siteId: config.siteId, limit: config.faceBackfillBatchSize }, headers, timeout: 30000,
      });
      for (const event of response.data?.events || []) await processEvent(event);
    } catch (error) {
      log.error("❌ Lấy hàng đợi quét khuôn mặt R2 lỗi:", error.response?.data?.error || error.message || error);
    } finally { running = false; }
  }

  return {
    run,
    start() {
      if (!config.pagesApiUrl || config.faceBackfillIntervalMs <= 0) return null;
      log.log(`🔁 Worker khuôn mặt R2 chạy mỗi ${config.faceBackfillIntervalMs}ms`);
      setTimeout(run, 5000);
      return setInterval(run, config.faceBackfillIntervalMs);
    },
  };
}

module.exports = { addDistinct, cosineSimilarity, createFaceBackfill };
