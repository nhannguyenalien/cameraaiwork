const axios = require("axios");
const FormData = require("form-data");
const config = require("../config");

async function sendVideoAlert(videoBuffer, caption) {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID chưa cấu hình, bỏ qua gửi alert.");
    return null;
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("video", videoBuffer, { filename: "motion.mp4" });
  form.append("caption", caption);

  const res = await axios.post(`https://api.telegram.org/bot${botToken}/sendVideo`, form, {
    headers: form.getHeaders(),
  });

  const msgId = res.data.result.message_id;
  const cleanChatId = chatId.toString().replace("-100", "");
  return `https://t.me/c/${cleanChatId}/${msgId}`;
}

module.exports = { sendVideoAlert };
