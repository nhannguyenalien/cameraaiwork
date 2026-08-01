export async function sendVideoAlert(env, clipBuffer, caption) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID chưa cấu hình, bỏ qua.");
    return null;
  }

  const form = new FormData();
  form.append("chat_id", env.TELEGRAM_CHAT_ID);
  form.append("video", new Blob([clipBuffer]), "motion.mp4");
  form.append("caption", caption);

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVideo`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram lỗi: ${JSON.stringify(data)}`);

  const msgId = data.result.message_id;
  const cleanChatId = env.TELEGRAM_CHAT_ID.toString().replace("-100", "");
  return `https://t.me/c/${cleanChatId}/${msgId}`;
}
