import { actionTools, requiresAgentConfirmation, validateAgentAction } from "./agentActions.js";

const DEFAULT_BASE_URL = "https://apic.schoolsai.work";
const MAX_TOOL_ROUNDS = 6;
const SUPPORT_CONTEXT = `Bạn là tư vấn viên cấp 1 của CameraAIWork. Chỉ tư vấn sản phẩm, tính năng, gói dịch vụ và cách dùng; không thực hiện thao tác tài khoản/camera.
Thông tin chính thức: CameraAIWork kết nối camera IP/ONVIF hiện có, xem trực tiếp, phát hiện người, nhận diện/đặt tên người, lưu ảnh/clip sự kiện, PTZ, cảnh báo Telegram, lưu R2/S3/Google Drive và có AI Agent vận hành bằng ngôn ngữ tự nhiên. Gói Free hỗ trợ tối đa 10 camera và 1 người xem đồng thời mỗi camera. Gói Pro không giới hạn camera và hỗ trợ 5 người xem đồng thời mỗi camera. Nếu chưa có giá tiền cụ thể trong dữ liệu, nói rõ giá chưa được công bố và hướng dẫn khách liên hệ, tuyệt đối không tự bịa giá. Trả lời ngắn gọn bằng ngôn ngữ của khách.`;

function settings(env) {
  const apiKey = String(env.SCHOOLSAI_API_KEY || "").trim();
  const baseUrl = String(env.SCHOOLSAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!apiKey) {
    const error = new Error("Chưa cấu hình SCHOOLSAI_API_KEY");
    error.status = 409;
    throw error;
  }
  return { apiKey, baseUrl };
}

async function post(env, path, body) {
  const { apiKey, baseUrl } = settings(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const remoteError = payload.error;
      const message = typeof remoteError === "object" ? remoteError?.message : remoteError;
      const error = new Error(message || payload.detail || payload.message || `SchoolsAI HTTP ${response.status}`);
      error.status = response.status === 429 ? 429 : 424;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function replyText(payload) {
  const value = payload.reply ?? payload.answer ?? payload.message ?? payload.data?.reply;
  return typeof value === "string" ? value.trim() : "";
}

function safeToolResult(value) {
  if (!value || typeof value !== "object" || !value.__agentMedia) return value;
  const { data: _data, ...media } = value.__agentMedia;
  return { ...value, __agentMedia: undefined, media: { ...media, mediaAttached: false } };
}

function parseDirective(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const normalize = (value) => {
    if (!value || typeof value !== "object") return value;
    if (!value.type && (value.name || value.tool)) {
      return { ...value, type: "tool", name: value.name || value.tool };
    }
    return value;
  };
  try { return normalize(JSON.parse(cleaned)); } catch (_) { /* plain-language answer */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return normalize(JSON.parse(cleaned.slice(start, end + 1))); } catch (_) { /* plain-language answer */ }
  }
  return { type: "answer", answer: cleaned };
}

function operatorProtocol(runtime = {}) {
  const now = runtime.now instanceof Date ? runtime.now : new Date();
  const timezoneOffsetMinutes = Number(runtime.timezoneOffsetMinutes || 420);
  const localNow = new Date(now.getTime() + timezoneOffsetMinutes * 60_000).toISOString().replace("Z", timezoneOffsetMinutes === 420 ? "+07:00" : " local");
  return `Bạn là AI vận hành CameraAIWork. Thời gian hiện tại: ${localNow}.
Chỉ trả lời bằng đúng một JSON object, không markdown:
1) Cần công cụ: {"tool":"ten_cong_cu","args":{}}
2) Trả lời người dùng: {"type":"answer","answer":"noi_dung_tieng_Viet"}
Không tự bịa dữ liệu camera. Câu hỏi đếm event phải gọi summarize_events. Công cụ thay đổi dữ liệu sẽ được hệ thống yêu cầu người dùng xác nhận. Không yêu cầu hoặc tiết lộ mật khẩu/API key.
Danh mục công cụ: ${JSON.stringify(actionTools())}`;
}

export function schoolsAiConfigured(env) {
  return Boolean(String(env.SCHOOLSAI_API_KEY || "").trim());
}

export async function chatSchoolsSupport(env, { session, question }) {
  const payload = await post(env, "/api/v1/chat", { session, question: `${SUPPORT_CONTEXT}\n\nCâu hỏi khách hàng: ${question}` });
  const answer = replyText(payload);
  if (!answer) throw new Error("SchoolsAI không trả về nội dung");
  return { answer };
}

export async function chatSchoolsOperator(env, { requestId, session, messages, execute, runtime = {} }) {
  const suppliedRequestId = String(requestId || "").trim();
  const operatorRequestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  const history = [
    { role: "user", content: operatorProtocol(runtime) },
    ...messages.slice(-20).map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 8_000) })),
  ];
  const toolResults = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const payload = await post(env, "/api/v1/operator-chat", {
      request_id: operatorRequestId,
      session,
      messages: history,
    });
    if (payload.request_id !== operatorRequestId) throw new Error("SchoolsAI trả sai request_id");
    const rawReply = replyText(payload);
    let directive = payload.type === "tool"
      ? { type: "tool", name: payload.name, args: payload.args, tool_call_id: payload.tool_call_id }
      : payload.type === "answer"
      // Compatibility for the current SchoolsAI deployment, which can wrap a
      // JSON tool directive inside an `answer` response.
      ? parseDirective(payload.answer)
      : parseDirective(rawReply);
    if (directive.type === "tool" && !directive.tool_call_id) {
      directive = { ...directive, tool_call_id: crypto.randomUUID() };
    }
    if (!rawReply && directive.type !== "tool") throw new Error("SchoolsAI không trả về nội dung");
    if (directive.type !== "tool") {
      return { answer: String(directive.answer || rawReply), proposals: [], toolResults };
    }
    const action = String(directive.name || "");
    const args = directive.args && typeof directive.args === "object" && !Array.isArray(directive.args) ? directive.args : {};
    const validationError = validateAgentAction(action, args);
    if (validationError) {
      history.push(
        { role: "assistant", content: JSON.stringify(directive) },
        { role: "user", content: JSON.stringify({ tool_call_id: directive.tool_call_id, tool_error: validationError }) },
      );
      continue;
    }
    if (requiresAgentConfirmation(action)) {
      return { answer: `Tôi cần bạn xác nhận trước khi thực hiện ${action}.`, proposals: [{ action, args }], toolResults };
    }
    try {
      const result = safeToolResult(await execute(action, args));
      toolResults.push({ action, args, result });
      history.push(
        { role: "assistant", content: JSON.stringify(directive) },
        { role: "user", content: JSON.stringify({ tool_call_id: directive.tool_call_id, tool_result: result }) },
      );
    } catch (error) {
      const result = { error: error.message || "Không thực hiện được công cụ" };
      toolResults.push({ action, args, result });
      history.push(
        { role: "assistant", content: JSON.stringify(directive) },
        { role: "user", content: JSON.stringify({ tool_call_id: directive.tool_call_id, tool_result: result }) },
      );
    }
  }
  throw new Error("SchoolsAI vượt quá số vòng gọi công cụ cho phép");
}
