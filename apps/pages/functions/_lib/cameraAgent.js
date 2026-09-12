const DAY_MS = 24 * 60 * 60 * 1000;
const VISIT_GAP_MS = 10 * 60 * 1000;

function validOffset(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= -720 && number <= 840 ? Math.trunc(number) : 420;
}

function localDayBounds(date, offsetMinutes) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const start = Date.UTC(year, month, day) - offsetMinutes * 60_000;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

export function resolveTimeRange(question, { now = new Date(), timezoneOffsetMinutes = 420 } = {}) {
  const offset = validOffset(timezoneOffsetMinutes);
  const text = String(question || "").toLocaleLowerCase("vi");
  const explicitDate = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (explicitDate) {
    const [, year, month, day] = explicitDate;
    const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) - offset * 60_000);
    const local = new Date(start.getTime() + offset * 60_000);
    if (local.getUTCFullYear() === Number(year) && local.getUTCMonth() === Number(month) - 1 && local.getUTCDate() === Number(day)) {
      return { start, end: new Date(start.getTime() + DAY_MS), timezoneOffsetMinutes: offset };
    }
  }

  const today = localDayBounds(now, offset);
  if (/h[oô]m qua|yesterday/.test(text)) {
    return { start: new Date(today.start.getTime() - DAY_MS), end: today.start, timezoneOffsetMinutes: offset };
  }

  const recentDays = text.match(/(?:trong|last)\s+(\d{1,2})\s+(?:ng[aà]y|days?)/);
  if (recentDays) {
    const days = Math.min(Math.max(Number(recentDays[1]), 1), 31);
    return { start: new Date(today.end.getTime() - days * DAY_MS), end: today.end, timezoneOffsetMinutes: offset };
  }
  return { ...today, timezoneOffsetMinutes: offset };
}

function peopleForEvent(event) {
  if (Array.isArray(event.people) && event.people.length) return event.people;
  if (event.person_id) return [{ id: event.person_id, label: event.person_label || null }];
  return [];
}

export function buildVisits(events, gapMs = VISIT_GAP_MS) {
  const visits = [];
  const active = new Map();
  const ordered = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const event of ordered) {
    const seenAt = new Date(event.timestamp);
    if (Number.isNaN(seenAt.getTime())) continue;
    for (const person of peopleForEvent(event)) {
      const key = person.id || `unknown:${event.id}`;
      let visit = active.get(key);
      if (!visit || seenAt - new Date(visit.lastSeenAt) > gapMs) {
        visit = {
          personId: person.id || null,
          personLabel: person.label || null,
          firstSeenAt: seenAt.toISOString(),
          lastSeenAt: seenAt.toISOString(),
          departureEstimated: true,
          eventIds: [],
          cameras: [],
          sites: [],
        };
        active.set(key, visit);
        visits.push(visit);
      }
      visit.lastSeenAt = seenAt.toISOString();
      if (!visit.eventIds.includes(Number(event.id))) visit.eventIds.push(Number(event.id));
      const camera = event.camera_name || event.camera;
      if (camera && !visit.cameras.includes(camera)) visit.cameras.push(camera);
      const site = event.site_name || event.site_id;
      if (site && !visit.sites.includes(site)) visit.sites.push(site);
    }
  }
  return visits;
}

function contextPrompt(question, range, cameras, events, visits) {
  return JSON.stringify({
    question,
    timeRange: { start: range.start.toISOString(), end: range.end.toISOString(), timezoneOffsetMinutes: range.timezoneOffsetMinutes },
    cameraInventory: cameras,
    visits,
    events: events.map((event) => ({
      id: Number(event.id), timestamp: event.timestamp, type: event.type,
      site: event.site_name || event.site_id, camera: event.camera_name || event.camera,
      people: peopleForEvent(event), hasImage: Boolean(event.image_key), videoStatus: event.video_status,
    })),
  });
}

const INSTRUCTIONS = `Bạn là trợ lý camera an ninh. Trả lời ngắn gọn bằng tiếng Việt, chỉ dựa trên JSON được cung cấp.
- Không suy đoán danh tính. Người chưa có label phải gọi là "Người chưa đặt tên" kèm personId.
- firstSeenAt là lần đầu camera thấy trong phiên; lastSeenAt chỉ là lần cuối thấy, KHÔNG phải bằng chứng rời đi.
- Khi nói giờ đi phải ghi rõ "ước lượng theo lần cuối xuất hiện".
- Dẫn event ID quan trọng dạng #123. Nếu không có dữ liệu, nói rõ không có event trong khoảng thời gian.
- Có thể tóm tắt thông số camera từ cameraInventory nhưng không được bịa thông số thiết bị không có trong dữ liệu.`;

async function responseError(response, provider) {
  const payload = await response.json().catch(() => ({}));
  const message = payload?.error?.message || payload?.error || `HTTP ${response.status}`;
  throw new Error(`${provider}: ${String(message).slice(0, 300)}`);
}

export async function askOpenAI(config, context) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model || "gpt-5-mini",
      instructions: INSTRUCTIONS,
      input: context,
      max_output_tokens: 900,
      store: false,
    }),
  });
  if (!response.ok) await responseError(response, "OpenAI");
  const payload = await response.json();
  const answer = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((part) => part.type === "output_text")?.text;
  if (!answer) throw new Error("OpenAI: phản hồi không có nội dung");
  return { answer, model: payload.model || config.model || "gpt-5-mini" };
}

export async function askGemini(config, context) {
  const model = config.model || "gemini-3.7-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
      contents: [{ role: "user", parts: [{ text: context }] }],
      generationConfig: { maxOutputTokens: 900 },
    }),
  });
  if (!response.ok) await responseError(response, "Gemini");
  const payload = await response.json();
  const answer = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!answer) throw new Error("Gemini: phản hồi không có nội dung");
  return { answer, model };
}

export function makeAgentContext(question, range, cameras, events) {
  const visits = buildVisits(events);
  return { visits, prompt: contextPrompt(question, range, cameras, events, visits) };
}
