import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { authenticateRelay, finishVisit, loadVoiceCamera } from "../../_lib/gateVoice.js";

// Relay -> backend: the visitor left (or went silent). Closes the visit and
// sends the owner a summary. Safe to call more than once.
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const site = await authenticateRelay(request, env);
  if (!site) return errorJson("Unauthorized", 401);
  const url = new URL(request.url);
  const stream = url.searchParams.get("camera");
  const visitId = url.searchParams.get("visit");
  if (!stream || !visitId) return errorJson("camera và visit là bắt buộc", 400);
  const { camera, error } = await loadVoiceCamera(env, site, stream);
  if (error) return error;
  const result = await finishVisit(env, visitId, camera);
  return result ? json(result) : errorJson("Visit not found", 404);
});
