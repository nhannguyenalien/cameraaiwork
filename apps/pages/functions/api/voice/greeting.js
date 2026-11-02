import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { getDb } from "../../_lib/db.js";
import { authenticateRelay, loadVoiceCamera, openVisit, voiceGreeting } from "../../_lib/gateVoice.js";

// Relay -> backend: spoken greeting for a visitor at a high-security camera.
// The audio is generated once per camera and cached (generation takes many
// seconds, far too slow to do while someone is standing at the gate).
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const site = await authenticateRelay(request, env);
  if (!site) return errorJson("Unauthorized", 401);
  const url = new URL(request.url);
  const stream = url.searchParams.get("camera");
  const visitId = url.searchParams.get("visit");
  if (!stream || !visitId || !/^[\w-]{8,64}$/.test(visitId)) return errorJson("camera và visit là bắt buộc", 400);

  const { camera, apiKey, error } = await loadVoiceCamera(env, site, stream);
  if (error) return error;
  await openVisit(env, camera, visitId);

  if (camera.voice_greeting_audio && url.searchParams.get("refresh") !== "1") {
    return json({ ...JSON.parse(camera.voice_greeting_audio), cached: true });
  }
  const greeting = await voiceGreeting(env, apiKey);
  const cached = { text: greeting.text, audioBase64: greeting.audioBase64 };
  await getDb(env, "api.voice.greeting").execute({
    sql: "UPDATE cameras SET voice_greeting_audio = ? WHERE id = ?",
    args: [JSON.stringify(cached), camera.id],
  });
  return json({ ...cached, cached: false });
});
