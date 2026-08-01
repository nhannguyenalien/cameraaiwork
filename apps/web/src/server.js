const path = require("path");
const express = require("express");

const config = require("./config");
const ptz = require("./services/ptz");
const go2rtc = require("./services/go2rtc");
const telegram = require("./services/telegram");
const db = require("./services/db");
const detection = require("./services/detection");

const app = express();
let isProcessingEvent = false;

async function handleMotion() {
  if (isProcessingEvent) return;
  isProcessingEvent = true;
  console.log("🏃 Chuyển động phát hiện, đang kiểm tra...");

  try {
    const frame = await go2rtc.getFrame();
    const personDetected = await detection.hasPerson(frame);

    if (personDetected) {
      console.log("🚨 Có người! Đang gửi cảnh báo...");
      const clip = await go2rtc.getClip(10);
      const caption = `🔔 Phát hiện người!\n⏰ ${new Date().toLocaleString("vi-VN")}`;
      const link = await telegram.sendVideoAlert(clip, caption);
      db.insertEvent("Person", link);
      console.log("✈️ Đã gửi Telegram thành công.");
    } else {
      console.log("👀 Chuyển động không có người, bỏ qua.");
    }
  } catch (error) {
    console.error("❌ Lỗi xử lý báo động:", error.message);
  }

  setTimeout(() => {
    isProcessingEvent = false;
  }, 30000); // nghỉ 30s tránh spam
}

function startMotionWatcher() {
  console.log("👀 Đang theo dõi chuyển động qua go2rtc...");
  go2rtc.watchEvents({
    onEvent: (data) => {
      if (data.includes('"on":true') || data.includes("motion")) {
        handleMotion();
      }
    },
    onDown: () => console.log("⚠️ Đang đợi go2rtc sẵn sàng..."),
  });
}

app.get("/move/:dir", (req, res) => {
  const { dir } = req.params;
  if (dir === "up") ptz.move(0, 0.5);
  else if (dir === "down") ptz.move(0, -0.5);
  else if (dir === "left") ptz.move(-0.5, 0);
  else if (dir === "right") ptz.move(0.5, 0);
  else if (dir === "stop") ptz.stop();
  res.sendStatus(200);
});

app.get("/history", async (req, res) => {
  res.json(await db.getRecentEvents(10));
});

app.get("/config.json", (req, res) => {
  res.json({ go2rtcUrl: config.go2rtc.publicUrl, stream: config.go2rtc.stream });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, "..", "public")));

ptz.connect(startMotionWatcher);
app.listen(config.port, () => console.log(`🚀 Server: http://localhost:${config.port}`));
