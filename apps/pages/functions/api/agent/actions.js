import { actionCatalog, requiresAgentConfirmation, validateAgentAction } from "../../_lib/agentActions.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";
import { onRequestGet as listCameras } from "../cameras/index.js";
import { onRequestGet as listPeople } from "../people/index.js";
import { onRequestGet as listEvents } from "../events/index.js";
import { onRequestGet as cameraStatus } from "../cameras/[site]/[camera]/status.js";
import { onRequestGet as cameraConfig, onRequestPut as updateCameraConfig } from "../cameras/[site]/[camera]/config.js";
import { onRequestPost as createLiveLink } from "../cameras/[site]/[camera]/live.js";
import { onRequestPatch as labelPerson } from "../people/[id].js";
import { onRequestPatch as setRecording } from "../cameras/[site]/[camera]/settings.js";
import { onRequestPost as moveCamera } from "../cameras/[site]/[camera]/ptz.js";
import { onRequestGet as listSites } from "../sites/index.js";
import { onRequestPost as scanCameras } from "../sites/[id]/discover.js";
import { onRequestPost as addCamera } from "../sites/[id]/cameras/index.js";
import { onRequestGet as cameraSnapshot } from "../cameras/[site]/[camera]/snapshot.js";
import { onRequestGet as eventImage } from "../events/[id]/image.js";
import { onRequestGet as eventVideo } from "../events/[id]/video.js";
import { getDb } from "../../_lib/db.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function mediaPayload(response, kind, question, source) {
  if (!response.ok) return response;
  const maximum = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maximum) return errorJson(`${kind === "video" ? "Video" : "Ảnh"} vượt giới hạn ${Math.round(maximum / 1024 / 1024)}MB`, 413);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maximum) return errorJson(`${kind === "video" ? "Video" : "Ảnh"} vượt giới hạn ${Math.round(maximum / 1024 / 1024)}MB`, 413);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || (kind === "video" ? "video/mp4" : "image/jpeg");
  return json({
    __agentMedia: {
      kind, mimeType, data: bytesToBase64(new Uint8Array(buffer)), source, size: buffer.byteLength,
      question: String(question || (kind === "video" ? "Hãy mô tả video, các sự kiện và mốc thời gian đáng chú ý." : "Hãy mô tả chính xác những gì nhìn thấy trong ảnh.")).slice(0, 500),
    },
  });
}

export const onRequestGet = withErrorHandling(async () => json({ actions: actionCatalog() }));

function requestWithJson(request, method, body) {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request.url, { method, headers, body: JSON.stringify(body) });
}

function eventRequest(request, args) {
  const url = new URL(request.url);
  url.pathname = "/api/events";
  for (const key of ["limit", "from", "to", "camera", "type", "acknowledged"]) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== "") url.searchParams.set(key, String(args[key]));
  }
  if (args.personId) url.searchParams.set("person", String(args.personId));
  return new Request(url, { method: "GET", headers: request.headers });
}

async function summarizeEvents(env, accountId, args) {
  const conditions = ["e.account_id = ?", "e.timestamp >= ?", "e.timestamp <= ?", "LOWER(COALESCE(e.type, '')) = 'person'"];
  const values = [accountId, args.from, args.to];
  if (args.siteId) { conditions.push("e.site_id = ?"); values.push(args.siteId); }
  if (args.camera) { conditions.push("e.camera = ?"); values.push(args.camera); }
  const result = await getDb(env).execute({
    sql: `WITH filtered_events AS (
            SELECT e.* FROM events e WHERE ${conditions.join(" AND ")}
          ), event_counts AS (
            SELECT filtered_events.id, filtered_events.timestamp,
                   CASE WHEN COUNT(ep.person_id) > 0 THEN COUNT(ep.person_id)
                        WHEN filtered_events.person_id IS NOT NULL THEN 1 ELSE 0 END AS appearance_count
            FROM filtered_events
            LEFT JOIN event_people ep ON ep.event_id = filtered_events.id
            GROUP BY filtered_events.id, filtered_events.timestamp, filtered_events.person_id
          ), identities AS (
            SELECT ep.person_id FROM event_people ep JOIN filtered_events fe ON fe.id = ep.event_id
            UNION
            SELECT person_id FROM filtered_events WHERE person_id IS NOT NULL
          )
          SELECT COUNT(*)::int AS person_event_count,
                 (SELECT COUNT(*)::int FROM identities) AS unique_recognized_people,
                 COALESCE(SUM(appearance_count), 0)::int AS recognized_person_appearances,
                 MIN(timestamp) AS first_detection_at,
                 MAX(timestamp) AS last_detection_at
          FROM event_counts`,
    args: values,
  });
  const row = result.rows[0] || {};
  return json({
    range: { from: args.from, to: args.to },
    personEventCount: Number(row.person_event_count || 0),
    uniqueRecognizedPeople: Number(row.unique_recognized_people || 0),
    recognizedPersonAppearances: Number(row.recognized_person_appearances || 0),
    firstDetectionAt: row.first_detection_at || null,
    lastDetectionAt: row.last_detection_at || null,
    note: "personEventCount là số event camera xác nhận có người; uniqueRecognizedPeople là số person ID khác nhau; recognizedPersonAppearances là tổng khuôn mặt gắn với event.",
  });
}

export async function executeAgentAction(action, args, context) {
  const { request, env, data } = context;
  const cameraParams = { site: args.siteId, camera: args.cameraId };
  switch (action) {
    case "list_sites": return listSites({ request, env, data, params: {} });
    case "scan_cameras": return scanCameras({ request, env, data, params: { id: args.siteId } });
    case "add_camera": {
      const { siteId: _siteId, ...camera } = args;
      return addCamera({ request: requestWithJson(request, "POST", camera), env, data, params: { id: args.siteId } });
    }
    case "list_cameras": return listCameras({ request, env, data, params: {} });
    case "list_people": return listPeople({ request, env, data, params: {} });
    case "list_recent_events": return listEvents({ request: eventRequest(request, args), env, data, params: {} });
    case "summarize_events": return summarizeEvents(env, data.accountId, args);
    case "camera_status": return cameraStatus({ request, env, data, params: cameraParams });
    case "camera_config": return cameraConfig({ request, env, data, params: cameraParams });
    case "get_live_link": return createLiveLink({ request, env, data, params: cameraParams });
    case "get_snapshot_link": {
      const url = new URL(request.url);
      url.pathname = `/api/cameras/${encodeURIComponent(args.siteId)}/${encodeURIComponent(args.cameraId)}/snapshot`;
      url.search = "";
      return json({ url: url.toString(), authenticationRequired: true });
    }
    case "inspect_camera_snapshot": return mediaPayload(
      await cameraSnapshot({ request, env, data, params: cameraParams }), "image", args.question,
      { type: "camera_snapshot", siteId: args.siteId, cameraId: args.cameraId },
    );
    case "inspect_event_media": {
      const handler = args.mediaType === "video" ? eventVideo : eventImage;
      const mediaResponse = await handler({ request, env, data, params: { id: args.eventId } });
      return mediaPayload(mediaResponse, args.mediaType, args.question, { type: "event", eventId: args.eventId });
    }
    case "label_person": return labelPerson({ request: requestWithJson(request, "PATCH", { label: args.label }), env, data, params: { id: args.personId } });
    case "set_recording": return setRecording({ request: requestWithJson(request, "PATCH", { recordOnPerson: args.recordOnPerson }), env, data, params: cameraParams });
    case "move_camera": {
      const { command, siteId: _siteId, cameraId: _cameraId, ...options } = args;
      return moveCamera({ request: requestWithJson(request, "POST", { ...options, action: command }), env, data, params: cameraParams });
    }
    case "update_camera_config": return updateCameraConfig({ request: requestWithJson(request, "PUT", args.config), env, data, params: cameraParams });
    default: return errorJson("action không hợp lệ", 400);
  }
}

export const onRequestPost = withErrorHandling(async (context) => {
  const body = await context.request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body", 400);
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const args = body.args ?? {};
  const validationError = validateAgentAction(action, args);
  if (validationError) return errorJson(validationError, 400);

  if (requiresAgentConfirmation(action) && body.confirmed !== true) {
    return json({
      error: "Thao tác này cần xác nhận trước khi thực thi",
      requiresConfirmation: true,
      proposal: { action, args },
    }, { status: 428 });
  }
  return executeAgentAction(action, args, context);
});
