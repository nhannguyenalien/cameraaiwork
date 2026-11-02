import { getCamera } from "../../../../_lib/sites.js";
import { getDb } from "../../../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../../../_lib/http.js";
import { accountUsage, normalizeClipDuration } from "../../../../_lib/plans.js";
import { sealVoiceKey, voiceBase } from "../../../../_lib/gateVoice.js";

export const onRequestPatch = withErrorHandling(async ({ request, params, env, data }) => {
  const body = await request.json().catch(() => null);
  const hasGateSettings = body && (body.securityLevel !== undefined || body.voiceApiKey !== undefined);
  if (!body || (body.recordOnPerson === undefined && body.clipDurationSeconds === undefined && !hasGateSettings)) return errorJson("Không có cài đặt để cập nhật", 400);
  if (body.securityLevel !== undefined && !["normal", "high"].includes(body.securityLevel)) return errorJson("securityLevel phải là normal hoặc high", 400);
  if (body.voiceApiKey !== undefined && body.voiceApiKey !== null && !/^sk_[A-Za-z0-9]{16,128}$/.test(body.voiceApiKey)) return errorJson("Khóa quản gia không hợp lệ", 400);
  if (body.recordOnPerson !== undefined && typeof body.recordOnPerson !== "boolean") return errorJson("recordOnPerson phải là true hoặc false", 400);

  const camera = await getCamera(env, data.accountId, params.site, params.camera);
  if (!camera) return errorJson("Camera not found", 404);

  const summary = await accountUsage(env, data.accountId);
  const savedOverride = camera.clip_duration_seconds == null ? null : Number(camera.clip_duration_seconds);
  let duration = savedOverride;
  if (body.clipDurationSeconds !== undefined) {
    const requestedDuration = body.clipDurationSeconds === null ? null : Number(body.clipDurationSeconds);
    duration = requestedDuration === null ? null : normalizeClipDuration(summary.plan, requestedDuration);
    if (requestedDuration !== null && duration !== requestedDuration) return errorJson("Thời lượng clip này chỉ dành cho gói Pro", 402);
  }
  let voiceKeyEnc = camera.voice_key_enc ?? null;
  if (body.voiceApiKey === null) voiceKeyEnc = null;
  else if (typeof body.voiceApiKey === "string") {
    const check = await fetch(`${voiceBase(env)}/api/v1/config`, { headers: { Authorization: `Bearer ${body.voiceApiKey}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!check?.ok) return errorJson("Khóa quản gia bị SchoolsAI từ chối", 400);
    voiceKeyEnc = await sealVoiceKey(env, body.voiceApiKey);
  }
  const securityLevel = body.securityLevel ?? camera.security_level ?? "normal";
  if (securityLevel === "high" && !voiceKeyEnc) return errorJson("Cần khóa quản gia (SchoolsAI) trước khi bật high security", 400);
  const recordOnPerson = body.recordOnPerson === undefined ? Boolean(Number(camera.record_on_person)) : body.recordOnPerson;
  await getDb(env, "api.cameras.[site].[camera].settings").execute({
    sql: "UPDATE cameras SET record_on_person = ?, clip_duration_seconds = ?, security_level = ?, voice_key_enc = ?, voice_greeting_audio = CASE WHEN ? THEN NULL ELSE voice_greeting_audio END WHERE id = ? AND site_id = ? AND account_id = ?",
    args: [recordOnPerson ? 1 : 0, duration, securityLevel, voiceKeyEnc, typeof body.voiceApiKey === "string" || body.voiceApiKey === null, camera.id, params.site, data.accountId],
  });
  return json({
    ok: true,
    recordOnPerson,
    securityLevel,
    voiceConfigured: Boolean(voiceKeyEnc),
    clipDurationOverrideSeconds: duration,
    clipDurationSeconds: normalizeClipDuration(summary.plan, duration ?? summary.clipDurationSeconds),
  });
});
