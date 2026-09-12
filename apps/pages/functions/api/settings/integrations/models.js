import { errorJson, json, withErrorHandling } from "../../../_lib/http.js";

const OPENAI_EXCLUDED = /(?:audio|realtime|transcribe|tts|image|search|embedding|moderation|whisper|dall-e)/i;

function sortModels(models, preferred) {
  return [...new Set(models)].sort((a, b) => {
    const aPreferred = preferred.indexOf(a);
    const bPreferred = preferred.indexOf(b);
    if (aPreferred !== -1 || bPreferred !== -1) return (aPreferred === -1 ? 999 : aPreferred) - (bPreferred === -1 ? 999 : bPreferred);
    return b.localeCompare(a, undefined, { numeric: true });
  });
}

async function upstreamError(response, provider) {
  const body = await response.json().catch(() => ({}));
  const detail = String(body?.error?.message || body?.error || `HTTP ${response.status}`).slice(0, 240);
  return errorJson(`${provider} từ chối API key: ${detail}`, 400);
}

export const onRequestPost = withErrorHandling(async ({ request }) => {
  const body = await request.json().catch(() => null);
  const provider = body?.provider;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!['openai', 'gemini'].includes(provider)) return errorJson("Provider không hợp lệ", 400);
  if (!apiKey || apiKey.length > 4096) return errorJson("API key không hợp lệ", 400);

  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return upstreamError(response, "OpenAI");
    const payload = await response.json();
    const models = (payload.data || []).map((item) => item.id).filter((id) => /^(?:gpt-|o\d)/i.test(id) && !OPENAI_EXCLUDED.test(id));
    return json({ provider, models: sortModels(models, ["gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4.1"]) });
  }

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return upstreamError(response, "Gemini");
  const payload = await response.json();
  const models = (payload.models || [])
    .filter((item) => item.supportedGenerationMethods?.includes("generateContent"))
    .map((item) => String(item.name || "").replace(/^models\//, ""))
    .filter((id) => /^gemini-/i.test(id));
  return json({ provider, models: sortModels(models, ["gemini-2.5-flash", "gemini-2.5-pro"]) });
});
