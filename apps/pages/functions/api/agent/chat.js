import { getIntegration } from "../../_lib/integrations.js";
import { chatGemini, chatOpenAI } from "../../_lib/agentChat.js";
import { requiresAgentConfirmation, validateAgentAction } from "../../_lib/agentActions.js";
import { executeAgentAction } from "./actions.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";
import { resolveTimeRange } from "../../_lib/cameraAgent.js";
import { listAgentMessages, saveAgentMessage } from "../../_lib/agentMessages.js";
import { chatSchoolsOperator, schoolsAiConfigured } from "../../_lib/schoolsAi.js";

async function credentials(env, accountId) {
  const [openai, gemini] = await Promise.all([
    getIntegration(env, accountId, "openai").catch(() => null), getIntegration(env, accountId, "gemini").catch(() => null),
  ]);
  return {
    openai: openai || (env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL } : null),
    gemini: gemini || (env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null),
  };
}

async function responseValue(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function requestedMedia(question) {
  const normalized = String(question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Operational phrases such as "bật ghi hình" describe a recording setting,
  // not a request to fetch event media. Remove them before looking for media
  // nouns so the UI does not attach unrelated event images to write proposals.
  const mediaText = normalized.replace(/\b(?:bat|tat|dung|tiep tuc)?\s*(?:ghi hinh|ghi anh|recording)\b/g, " ");
  if (/\b(video|clip)\b/.test(mediaText)) return "video";
  if (/\b(hinh|anh|khuon mat|face)\b/.test(mediaText)) return "image";
  return null;
}

function requestId(value) {
  const supplied = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function requestedMediaCount(question) {
  const normalized = String(question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const match = normalized.match(/(?:xem|cho|lay|hien thi)?\s*(\d{1,2})\s*(?:hinh|anh|video|clip)/);
  return Math.max(1, Math.min(Number(match?.[1] || 4), 12));
}

function removeGeneratedMediaLinks(answer) {
  return String(answer || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*\d+\.\s*$/gm, "")
    .replace(/^.*(?:đường dẫn|duong dan).*(?:minh họa|minh hoa).*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function wantsIdentifyPeople(question) {
  const text = normalizedText(question);
  return /(nhan dien|dat ten|gan ten)/.test(text) && /(tung nguoi|nguoi la|nhom nguoi|qua anh)/.test(text);
}

function proposedPersonLabel(question) {
  const raw = String(question || "").trim();
  if (!raw || /^(bỏ qua|bo qua|tiếp|tiep|người tiếp|nguoi tiep|dừng|dung)$/i.test(normalizedText(raw))) return null;
  return raw.replace(/^(?:đây|đó|người này|nguoi nay|nhóm này|nhom nay)?\s*(?:là|la|tên là|ten la)\s*/i, "").trim().slice(0, 100) || null;
}

async function nextIdentification(execute, context = {}, skipActive = false) {
  const people = await execute("list_people", {});
  const candidates = (Array.isArray(people) ? people : []).filter((person) => !String(person.label || "").trim() && person.preview_event_id);
  const requested = Array.isArray(context.pendingPersonIds) ? context.pendingPersonIds.map(String) : [];
  const remaining = requested.length ? requested : candidates.map((person) => String(person.id));
  const excluded = skipActive ? String(context.activePersonId || "") : "";
  const person = remaining.map((id) => candidates.find((item) => String(item.id) === id)).find((item) => item && String(item.id) !== excluded);
  if (!person) return { answer: "Đã duyệt hết các nhóm người chưa đặt tên có ảnh đại diện.", attachments: [], mediaRequested: true, conversationContext: null };
  const pendingPersonIds = remaining.filter((id) => id !== excluded);
  return {
    answer: `Đây là một nhóm người chưa đặt tên (${Number(person.seen_count) || 0} lần xuất hiện). Bạn hãy trả lời tên hoặc thông tin muốn lưu, ví dụ “Đây là Nam”. Bạn cũng có thể nói “bỏ qua” hoặc “dừng”.`,
    attachments: [{ eventId: person.preview_event_id, kind: "image", personId: person.id }], mediaRequested: true,
    conversationContext: { mode: "identify_people", activePersonId: String(person.id), pendingPersonIds },
  };
}

async function automaticAttachments(question, timezoneOffsetMinutes, execute, toolResults = []) {
  const kind = requestedMedia(question);
  if (!kind) return [];
  const count = requestedMediaCount(question);
  const inspected = toolResults
    .filter((item) => item.action === "inspect_event_media" && item.result?.source?.eventId && item.result?.kind === kind)
    .map((item) => ({ eventId: item.result.source.eventId, kind }));
  const range = resolveTimeRange(question, { timezoneOffsetMinutes });
  const events = await execute("list_recent_events", {
    from: range.start.toISOString(), to: range.end.toISOString(), type: "Person", limit: 100,
  });
  const available = (Array.isArray(events) ? events : [])
    .filter((event) => kind === "video" ? event.video_status === "ready" : Boolean(event.image_key))
    .map((event) => ({ eventId: event.id, kind, timestamp: event.timestamp, camera: event.camera }));
  return [...inspected, ...available]
    .filter((item, index, all) => all.findIndex((other) => String(other.eventId) === String(item.eventId) && other.kind === item.kind) === index)
    .slice(0, count);
}

// Every turn also lands in `agent_messages` (waitUntil, off the response
// path) so the dashboard can show a continuous history across reloads —
// see _lib/agentMessages.js. Failures here are logged, never surfaced to
// the user: a chat answer that arrived but failed to save is still a
// successful chat answer.
function persistTurn(context, userText, assistantText) {
  const { env, data } = context;
  context.waitUntil(Promise.all([
    userText ? saveAgentMessage(env, data.accountId, "user", userText) : null,
    assistantText ? saveAgentMessage(env, data.accountId, "assistant", assistantText) : null,
  ]).catch((error) => console.error("Lưu agent chat thất bại:", error.message || error)));
}

export const onRequestGet = withErrorHandling(async ({ request, env, data }) => {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const sinceParam = url.searchParams.get("since");
  const messages = await listAgentMessages(env, data.accountId, {
    limit: limitParam ? Number(limitParam) : undefined,
    since: sinceParam ? Number(sinceParam) : null,
  });
  return json({ messages });
});

export const onRequestPost = withErrorHandling(async (context) => {
  const body = await context.request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body", 400);
  const clientRequestId = requestId(body.requestId);
  if (body.provider && !["auto", "schoolsai", "openai", "gemini"].includes(body.provider)) return errorJson("provider không hợp lệ", 400);

  if (body.confirmedAction) {
    const { action, args = {} } = body.confirmedAction;
    const validationError = validateAgentAction(action, args);
    if (validationError) return errorJson(validationError, 400);
    if (!requiresAgentConfirmation(action)) return errorJson("Action này không cần xác nhận", 400);
    const result = await responseValue(await executeAgentAction(action, args, context));
    if (action === "label_person" && body.conversationContext?.mode === "identify_people") {
      const execute = async (nextAction, nextArgs) => responseValue(await executeAgentAction(nextAction, nextArgs, context));
      const next = await nextIdentification(execute, body.conversationContext, true);
      const answer = `Đã lưu tên “${result.label}”.\n\n${next.answer}`;
      persistTurn(context, null, answer);
      return json({ ...next, answer, action, result, requestId: clientRequestId });
    }
    const answer = `Đã thực hiện ${action} thành công.`;
    persistTurn(context, null, answer);
    return json({ answer, action, result, requestId: clientRequestId });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || !messages.some((item) => item?.role === "user" && String(item.content || "").trim())) return errorJson("messages phải có câu hỏi của người dùng", 400);
  const configured = await credentials(context.env, context.data.accountId);
  const timezoneOffsetMinutes = Number.isFinite(Number(body.timezoneOffsetMinutes))
    ? Math.max(-720, Math.min(840, Math.trunc(Number(body.timezoneOffsetMinutes))))
    : 420;
  const runtime = { timezoneOffsetMinutes, now: new Date() };
  let order = body.provider === "schoolsai" ? ["schoolsai"] : body.provider === "openai" ? ["openai"] : body.provider === "gemini" ? ["gemini"] : ["schoolsai", "openai", "gemini"];
  const failures = [];
  const execute = async (action, args) => responseValue(await executeAgentAction(action, args, context));
  const latestQuestion = [...messages].reverse().find((item) => item?.role === "user")?.content || "";
  // SchoolsAI is text/tool orchestration only. Preserve the existing vision
  // providers for automatic image/video inspection when the user chose Auto.
  if ((!body.provider || body.provider === "auto") && requestedMedia(latestQuestion)) order = ["openai", "gemini"];
  const conversationContext = body.conversationContext?.mode === "identify_people" ? body.conversationContext : null;
  if (wantsIdentifyPeople(latestQuestion)) {
    const next = await nextIdentification(execute);
    persistTurn(context, latestQuestion, next.answer);
    return json({ ...next, requestId: clientRequestId });
  }
  if (conversationContext) {
    const command = normalizedText(latestQuestion);
    if (/^(dung|ket thuc|thoat)$/.test(command)) {
      const answer = "Đã dừng chế độ nhận diện và đặt tên người.";
      persistTurn(context, latestQuestion, answer);
      return json({ answer, conversationContext: null, requestId: clientRequestId });
    }
    if (/^(bo qua|tiep|nguoi tiep)$/.test(command)) {
      const next = await nextIdentification(execute, conversationContext, true);
      persistTurn(context, latestQuestion, next.answer);
      return json({ ...next, requestId: clientRequestId });
    }
    const label = proposedPersonLabel(latestQuestion);
    if (label) {
      const answer = `Bạn muốn lưu tên/thông tin “${label}” cho người trong ảnh vừa hiển thị phải không?`;
      persistTurn(context, latestQuestion, answer);
      return json({
        answer,
        proposals: [{ action: "label_person", args: { personId: conversationContext.activePersonId, label } }],
        attachments: [], conversationContext, requestId: clientRequestId,
      });
    }
  }
  for (const provider of order) {
    if (provider === "schoolsai" ? !schoolsAiConfigured(context.env) : !configured[provider]) continue;
    try {
      const result = provider === "schoolsai"
        ? await chatSchoolsOperator(context.env, { requestId: clientRequestId, session: `cameraai-operator-${context.data.accountId}-${clientRequestId}`, messages, execute, runtime })
        : provider === "openai"
        ? await chatOpenAI(configured.openai, messages, execute, runtime)
        : await chatGemini(configured.gemini, messages, execute, runtime);
      const attachments = await automaticAttachments(latestQuestion, timezoneOffsetMinutes, execute, result.toolResults).catch(() => []);
      const mediaKind = requestedMedia(latestQuestion);
      const answer = mediaKind
        ? `${removeGeneratedMediaLinks(result.answer)}\n\n${attachments.length ? `Đã đính kèm ${attachments.length} ${mediaKind === "video" ? "video" : "ảnh"} thật từ event camera bên dưới.` : `Không tìm thấy ${mediaKind === "video" ? "video đã sẵn sàng" : "ảnh event"} trong khoảng thời gian này.`}`
        : result.answer;
      persistTurn(context, latestQuestion, answer);
      return json({ ...result, answer, provider, attachments, mediaRequested: Boolean(mediaKind), requestId: clientRequestId });
    } catch (error) {
      console.error(`AI provider ${provider} failed:`, error.message);
      failures.push(error.message);
    }
  }
  if (!order.some((provider) => provider === "schoolsai" ? schoolsAiConfigured(context.env) : configured[provider])) return errorJson("Chưa cấu hình SchoolsAI, OpenAI hoặc Gemini API key", 409);
  return errorJson(`Không gọi được AI provider: ${failures.join("; ")}`, 424);
});
