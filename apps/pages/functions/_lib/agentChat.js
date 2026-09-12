import { actionTools, requiresAgentConfirmation, validateAgentAction } from "./agentActions.js";

const SYSTEM = `Bạn là AI Agent quản trị CameraAIWork. Luôn trả lời tiếng Việt, ngắn gọn và chính xác.
Bạn có thể dùng tool để đọc site, camera, event, người, trạng thái, cấu hình, ảnh snapshot và media của event; quét camera trong LAN; hoặc đề xuất thao tác quản trị.
Luôn dùng tool thay vì đoán ID hay trạng thái. Không bao giờ yêu cầu hoặc lặp lại API key. Không suy đoán danh tính người chưa được đặt tên.
Khi hỏi số người hoặc "bao nhiêu", luôn dùng summarize_events thay vì tự đếm list_recent_events. Hãy phân biệt: số người duy nhất, tổng lượt khuôn mặt được nhận diện, và số event camera phát hiện người. Một event có thể chứa nhiều người.
Chỉ mô tả nội dung hình ảnh/video sau khi đã dùng tool inspect tương ứng. Khi người dùng hỏi video, dùng inspect_event_media với mediaType=video.
TUYỆT ĐỐI không tự tạo URL, Markdown ảnh/video, đường dẫn example.com hay nói đường dẫn chỉ mang tính minh họa. Media thật sẽ được ứng dụng tự đính kèm bên dưới câu trả lời. Khi người dùng yêu cầu ảnh/video, chỉ trả lời phần thống kê và nói ứng dụng sẽ hiển thị media thật nếu event có lưu media.
Thao tác thay đổi hệ thống sẽ được ứng dụng chặn để người dùng xác nhận. Hãy giải thích rõ tác động của đề xuất đó.`;

function systemPrompt(runtime = {}) {
  const offset = Number.isFinite(Number(runtime.timezoneOffsetMinutes)) ? Math.max(-720, Math.min(840, Math.trunc(Number(runtime.timezoneOffsetMinutes)))) : 420;
  const now = runtime.now instanceof Date ? runtime.now : new Date();
  const local = new Date(now.getTime() + offset * 60_000);
  const localIso = `${local.toISOString().slice(0, 19)}${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  return `${SYSTEM}\nThời gian hiện tại: ${now.toISOString()} UTC; giờ địa phương người dùng: ${localIso}. Với “sáng nay”, truy vấn từ 00:00 giờ địa phương đến thời điểm hiện tại (không vượt quá 12:00). Luôn truyền from/to dạng ISO có múi giờ vào summarize_events hoặc list_recent_events.`;
}

async function providerError(response, provider) {
  const body = await response.json().catch(() => ({}));
  throw new Error(`${provider}: ${String(body?.error?.message || body?.error || `HTTP ${response.status}`).slice(0, 300)}`);
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : []).slice(-20).map((item) => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: String(item?.content || "").slice(0, 4000),
  })).filter((item) => item.content);
}

async function runTool(call, execute) {
  const args = call.args && typeof call.args === "object" ? call.args : {};
  const validationError = validateAgentAction(call.name, args);
  if (validationError) return { error: validationError };
  if (requiresAgentConfirmation(call.name)) return { proposal: { action: call.name, args } };
  return { result: await execute(call.name, args) };
}

function separateMedia(outcome) {
  const media = outcome?.result?.__agentMedia;
  if (!media) return { media: null, safeOutcome: outcome };
  return {
    media,
    safeOutcome: {
      ...outcome,
      result: {
        mediaAttached: true, kind: media.kind, mimeType: media.mimeType, size: media.size, source: media.source,
      },
    },
  };
}

function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "additionalProperties" || key === "minProperties") continue;
    if (key === "type" && Array.isArray(child)) {
      result.type = child.find((item) => item !== "null") || "string";
      result.nullable = child.includes("null");
    } else result[key] = geminiSchema(child);
  }
  return result;
}

export async function chatOpenAI(config, messages, execute, runtime) {
  const tools = actionTools().map((tool) => ({ type: "function", ...tool, strict: false }));
  let input = cleanMessages(messages);
  const proposals = [];
  const toolResults = [];
  for (let round = 0; round < 5; round += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model || "gpt-5-mini", instructions: systemPrompt(runtime), input, tools, store: false, max_output_tokens: 1200 }),
    });
    if (!response.ok) await providerError(response, "OpenAI");
    const payload = await response.json();
    const calls = (payload.output || []).filter((item) => item.type === "function_call");
    if (!calls.length) {
      const answer = payload.output_text || (payload.output || []).flatMap((item) => item.content || []).find((part) => part.type === "output_text")?.text;
      return { answer: answer || (proposals.length ? "Vui lòng xác nhận thao tác được đề xuất." : "Tôi chưa có đủ dữ liệu để trả lời."), model: payload.model || config.model, proposals, toolResults };
    }
    input.push(...(payload.output || []));
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
      const outcome = await runTool({ name: call.name, args }, execute);
      const { media, safeOutcome } = separateMedia(outcome);
      if (outcome.proposal) proposals.push(outcome.proposal);
      if (safeOutcome.result !== undefined) toolResults.push({ action: call.name, result: safeOutcome.result });
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(safeOutcome) });
      if (media?.kind === "video") throw new Error("OpenAI không nhận video trực tiếp trong luồng này; hãy chọn Gemini hoặc chế độ Tự động");
      if (media) input.push({
        role: "user",
        content: [
          { type: "input_text", text: media.question },
          { type: "input_image", image_url: `data:${media.mimeType};base64,${media.data}`, detail: "auto" },
        ],
      });
    }
    if (proposals.length) return { answer: "Tôi đã chuẩn bị thao tác thay đổi hệ thống. Vui lòng kiểm tra và xác nhận trước khi thực hiện.", model: payload.model || config.model, proposals, toolResults };
  }
  return { answer: "Đã đạt giới hạn thao tác trong một lượt chat.", model: config.model || "gpt-5-mini", proposals, toolResults };
}

export async function chatGemini(config, messages, execute, runtime) {
  const model = config.model || "gemini-2.5-flash";
  const contents = cleanMessages(messages).map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] }));
  const tools = [{ functionDeclarations: actionTools().map((tool) => ({ ...tool, parameters: geminiSchema(tool.parameters) })) }];
  const proposals = [];
  const toolResults = [];
  for (let round = 0; round < 5; round += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt(runtime) }] }, contents, tools, generationConfig: { maxOutputTokens: 1200 } }),
    });
    if (!response.ok) await providerError(response, "Gemini");
    const payload = await response.json();
    const modelContent = payload.candidates?.[0]?.content;
    const parts = modelContent?.parts || [];
    const calls = parts.filter((part) => part.functionCall);
    if (!calls.length) return { answer: parts.map((part) => part.text || "").join("").trim() || (proposals.length ? "Vui lòng xác nhận thao tác được đề xuất." : "Tôi chưa có đủ dữ liệu để trả lời."), model, proposals, toolResults };
    contents.push(modelContent);
    const responseParts = [];
    for (const part of calls) {
      const call = part.functionCall;
      const outcome = await runTool({ name: call.name, args: call.args || {} }, execute);
      const { media, safeOutcome } = separateMedia(outcome);
      if (outcome.proposal) proposals.push(outcome.proposal);
      if (safeOutcome.result !== undefined) toolResults.push({ action: call.name, result: safeOutcome.result });
      responseParts.push({ functionResponse: { name: call.name, id: call.id, response: safeOutcome } });
      if (media) {
        responseParts.push({ text: media.question });
        responseParts.push({ inlineData: { mimeType: media.mimeType, data: media.data } });
      }
    }
    contents.push({ role: "user", parts: responseParts });
    if (proposals.length) return { answer: "Tôi đã chuẩn bị thao tác thay đổi hệ thống. Vui lòng kiểm tra và xác nhận trước khi thực hiện.", model, proposals, toolResults };
  }
  return { answer: "Đã đạt giới hạn thao tác trong một lượt chat.", model, proposals, toolResults };
}
