// Sends a snapshot, not a video clip — go2rtc has no "export N seconds as
// a file" endpoint (only a live progressive /api/stream.mp4), so alerts
// use the same JPEG frame that was already fetched for the AI check
// rather than a video. See the note in _lib/go2rtc.js.
export async function sendPhotoAlert(config, frameBuffer, caption) {
  if (!config?.botToken || !config?.chatId) {
    console.warn("Tài khoản chưa cấu hình Telegram, bỏ qua cảnh báo.");
    return null;
  }

  const form = new FormData();
  form.append("chat_id", config.chatId);
  form.append("photo", new Blob([frameBuffer]), "motion.jpg");
  form.append("caption", caption);

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram lỗi: ${JSON.stringify(data)}`);

  const msgId = data.result.message_id;
  const cleanChatId = config.chatId.toString().replace("-100", "");
  return `https://t.me/c/${cleanChatId}/${msgId}`;
}

// Plain-text message, for reports that have no single frame to attach
// (e.g. a periodic digest summarizing several events at once).
export async function sendTextAlert(config, text) {
  if (!config?.botToken || !config?.chatId) {
    console.warn("Tài khoản chưa cấu hình Telegram, bỏ qua cảnh báo.");
    return null;
  }

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram lỗi: ${JSON.stringify(data)}`);

  const msgId = data.result.message_id;
  const cleanChatId = config.chatId.toString().replace("-100", "");
  return `https://t.me/c/${cleanChatId}/${msgId}`;
}
