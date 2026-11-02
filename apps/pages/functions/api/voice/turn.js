import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import {
  MAX_AUDIO_BYTES, MAX_TURNS, authenticateRelay, finishVisit, loadVoiceCamera, openVisit,
  recordTurn, visitUsable, voiceTurn,
} from "../../_lib/gateVoice.js";

// Relay -> backend: one spoken turn from the visitor (raw audio/* body).
// Returns the butler's reply (text + audio). `done` tells the relay to stop
// listening: the conversation hit its turn limit or needs the owner.
export const onRequestPost = withErrorHandling(async ({ request, env, waitUntil }) => {
  const site = await authenticateRelay(request, env);
  if (!site) return errorJson("Unauthorized", 401);
  const url = new URL(request.url);
  const stream = url.searchParams.get("camera");
  const visitId = url.searchParams.get("visit");
  if (!stream || !visitId || !/^[\w-]{8,64}$/.test(visitId)) return errorJson("camera và visit là bắt buộc", 400);
  const type = request.headers.get("content-type") || "";
  if (!type.startsWith("audio/")) return errorJson("Yêu cầu phải chứa audio", 415);
  const audio = await request.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > MAX_AUDIO_BYTES) return errorJson("Audio trống hoặc quá lớn", 413);

  const { camera, apiKey, error } = await loadVoiceCamera(env, site, stream);
  if (error) return error;
  const visit = await openVisit(env, camera, visitId);
  if (!visitUsable(visit)) return json({ done: true, reason: "limit", reply: "", audioBase64: null, needsHuman: Boolean(visit?.needs_human) });

  const durationMs = Number(request.headers.get("x-duration-ms")) || undefined;
  const result = await voiceTurn(env, apiKey, audio, type, visit.id, durationMs);
  const reply = String(result.reply || "");
  const needsHuman = result.needsHuman === true;
  await recordTurn(env, visit, { transcript: String(result.transcript || ""), reply, needsHuman });
  const done = needsHuman || Number(visit.turns) + 1 >= MAX_TURNS;
  if (done) waitUntil(finishVisit(env, visit.id, camera));
  return json({
    transcript: result.transcript || "",
    reply,
    audioBase64: result.audioBase64 || null,
    needsHuman,
    done,
    turns: Number(visit.turns) + 1,
  });
});
