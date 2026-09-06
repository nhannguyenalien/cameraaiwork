import { getDb } from "../../_lib/db.js";
import { integrationStatus, setIntegration } from "../../_lib/integrations.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  return json(await integrationStatus(env, data.accountId));
});

export const onRequestPut = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("JSON không hợp lệ", 400);
  if (body.provider === "telegram") {
    if (!body.botToken?.trim() || !body.chatId?.trim()) return errorJson("Thiếu bot token hoặc chat ID", 400);
    await setIntegration(env, data.accountId, "telegram", { botToken: body.botToken.trim(), chatId: body.chatId.trim() });
  } else if (body.provider === "runpod") {
    if (!body.apiKey?.trim() || !body.endpointId?.trim()) return errorJson("Thiếu API key hoặc endpoint ID", 400);
    await setIntegration(env, data.accountId, "runpod", { apiKey: body.apiKey.trim(), endpointId: body.endpointId.trim() });
  } else {
    return errorJson("Provider không hợp lệ", 400);
  }
  return json({ ok: true, provider: body.provider });
});

export const onRequestDelete = withErrorHandling(async ({ request, env, data }) => {
  const { provider } = await request.json().catch(() => ({}));
  if (!['telegram', 'runpod'].includes(provider)) return errorJson("Provider không hợp lệ", 400);
  await getDb(env).execute({ sql: "DELETE FROM account_integrations WHERE account_id = ? AND provider = ?", args: [data.accountId, provider] });
  return json({ ok: true });
});
