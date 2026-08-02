// Sends a snapshot, not a video clip — go2rtc has no "export N seconds as
// a file" endpoint (only a live progressive /api/stream.mp4), so alerts
// use the same JPEG frame that was already fetched for the AI check
// rather than a video. See the note in _lib/go2rtc.js.
export async function sendPhotoAlert(env, frameBuffer, caption) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID chưa cấu hình, bỏ qua.");
    return null;
  }

  const form = new FormData();
  form.append("chat_id", env.TELEGRAM_CHAT_ID);
  form.append("photo", new Blob([frameBuffer]), "motion.jpg");
  form.append("caption", caption);

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram lỗi: ${JSON.stringify(data)}`);

  const msgId = data.result.message_id;
  const cleanChatId = env.TELEGRAM_CHAT_ID.toString().replace("-100", "");
  return `https://t.me/c/${cleanChatId}/${msgId}`;
}
