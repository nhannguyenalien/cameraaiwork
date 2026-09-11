export const AGENT_ACTIONS = Object.freeze({
  list_sites: {
    description: "Liệt kê nhà/site, trạng thái relay và số camera",
    readOnly: true,
    parameters: {},
  },
  scan_cameras: {
    description: "Quét mạng LAN của một site để tìm camera ONVIF",
    readOnly: true,
    parameters: { siteId: "required" },
  },
  add_camera: {
    description: "Thêm camera vào site; relay sẽ tự dò RTSP/ONVIF khi autoConfigure=true",
    readOnly: false,
    parameters: {
      siteId: "required", name: "required", ip: "required", username: "required", password: "required",
      rtspPort: "integer 1..65535", onvifPort: "integer 1..65535", rtspPath: "string", autoConfigure: "boolean",
    },
  },
  list_cameras: {
    description: "Liệt kê camera và site thuộc tài khoản",
    readOnly: true,
    parameters: {},
  },
  list_people: {
    description: "Liệt kê người đã nhận diện, kể cả người chưa đặt tên",
    readOnly: true,
    parameters: {},
  },
  list_recent_events: {
    description: "Tìm event gần đây theo thời gian, camera, người hoặc trạng thái",
    readOnly: true,
    parameters: {
      limit: "integer 1..100",
      from: "ISO datetime",
      to: "ISO datetime",
      camera: "camera stream",
      personId: "person id",
      type: "event type",
      acknowledged: "boolean",
    },
  },
  summarize_events: {
    description: "Đếm chính xác event phát hiện người, lượt khuôn mặt và người duy nhất trong một khoảng thời gian; ưu tiên tool này cho câu hỏi 'bao nhiêu'",
    readOnly: true,
    parameters: {
      from: "ISO datetime, required",
      to: "ISO datetime, required",
      siteId: "site id",
      camera: "camera stream",
    },
  },
  camera_status: {
    description: "Kiểm tra camera/relay online và khả năng PTZ",
    readOnly: true,
    parameters: { siteId: "required", cameraId: "required" },
  },
  camera_config: {
    description: "Đọc cấu hình camera hiện tại từ relay",
    readOnly: true,
    parameters: { siteId: "required", cameraId: "required" },
  },
  get_live_link: {
    description: "Tạo link xem trực tiếp có thời hạn 5 phút",
    readOnly: true,
    parameters: { siteId: "required", cameraId: "required" },
  },
  get_snapshot_link: {
    description: "Trả về API URL để lấy ảnh chụp hiện tại",
    readOnly: true,
    parameters: { siteId: "required", cameraId: "required" },
  },
  inspect_camera_snapshot: {
    description: "Chụp và đọc nội dung hình ảnh hiện tại của camera bằng AI Vision; dùng khi cần biết camera đang thấy gì",
    readOnly: true,
    parameters: { siteId: "required", cameraId: "required", question: "câu hỏi về ảnh (tối đa 500 ký tự)" },
  },
  inspect_event_media: {
    description: "Đọc ảnh hoặc video ngắn đã lưu của một event bằng AI Vision; video cần model Gemini",
    readOnly: true,
    parameters: { eventId: "required", mediaType: "image|video", question: "câu hỏi về media (tối đa 500 ký tự)" },
  },
  label_person: {
    description: "Đặt hoặc xoá tên của một người đã nhận diện",
    readOnly: false,
    parameters: { personId: "required", label: "string or null" },
  },
  set_recording: {
    description: "Bật/tắt lưu clip khi camera phát hiện người",
    readOnly: false,
    parameters: { siteId: "required", cameraId: "required", recordOnPerson: "boolean" },
  },
  move_camera: {
    description: "Điều khiển PTZ, zoom, home hoặc preset",
    readOnly: false,
    parameters: {
      siteId: "required",
      cameraId: "required",
      command: "up|down|left|right|stop|zoomIn|zoomOut|home|gotoPreset|setPreset",
      speed: "number 0.1..1",
      durationMs: "integer 100..5000",
      preset: "preset name/number",
    },
  },
  update_camera_config: {
    description: "Cập nhật cấu hình camera trên relay",
    readOnly: false,
    parameters: { siteId: "required", cameraId: "required", config: "non-empty object" },
  },
});

export function actionCatalog() {
  return Object.entries(AGENT_ACTIONS).map(([name, definition]) => ({ name, ...definition, requiresConfirmation: !definition.readOnly }));
}

const STRING = { type: "string" };
const CAMERA_PAIR = {
  type: "object", additionalProperties: false,
  properties: { siteId: STRING, cameraId: STRING }, required: ["siteId", "cameraId"],
};

const ACTION_SCHEMAS = {
  list_sites: { type: "object", properties: {}, additionalProperties: false },
  scan_cameras: { type: "object", properties: { siteId: STRING }, required: ["siteId"], additionalProperties: false },
  add_camera: {
    type: "object", additionalProperties: false,
    properties: {
      siteId: STRING, name: STRING, ip: STRING, username: STRING, password: STRING,
      rtspPort: { type: "integer", minimum: 1, maximum: 65535 },
      onvifPort: { type: "integer", minimum: 1, maximum: 65535 }, rtspPath: STRING, autoConfigure: { type: "boolean" },
    },
    required: ["siteId", "name", "ip", "username", "password", "rtspPort", "onvifPort", "rtspPath", "autoConfigure"],
  },
  list_cameras: { type: "object", properties: {}, additionalProperties: false },
  list_people: { type: "object", properties: {}, additionalProperties: false },
  list_recent_events: {
    type: "object", additionalProperties: false,
    properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, from: STRING, to: STRING, camera: STRING, personId: STRING, type: STRING, acknowledged: { type: "boolean" } },
  },
  summarize_events: {
    type: "object", additionalProperties: false,
    properties: { from: STRING, to: STRING, siteId: STRING, camera: STRING },
    required: ["from", "to"],
  },
  camera_status: CAMERA_PAIR, camera_config: CAMERA_PAIR, get_live_link: CAMERA_PAIR, get_snapshot_link: CAMERA_PAIR,
  inspect_camera_snapshot: { type: "object", additionalProperties: false, properties: { siteId: STRING, cameraId: STRING, question: { type: "string", maxLength: 500 } }, required: ["siteId", "cameraId"] },
  inspect_event_media: { type: "object", additionalProperties: false, properties: { eventId: STRING, mediaType: { type: "string", enum: ["image", "video"] }, question: { type: "string", maxLength: 500 } }, required: ["eventId", "mediaType"] },
  label_person: { type: "object", properties: { personId: STRING, label: { type: ["string", "null"], maxLength: 100 } }, required: ["personId", "label"], additionalProperties: false },
  set_recording: { type: "object", properties: { siteId: STRING, cameraId: STRING, recordOnPerson: { type: "boolean" } }, required: ["siteId", "cameraId", "recordOnPerson"], additionalProperties: false },
  move_camera: { type: "object", properties: { siteId: STRING, cameraId: STRING, command: { type: "string", enum: ["up", "down", "left", "right", "stop", "zoomIn", "zoomOut", "home", "gotoPreset", "setPreset"] }, speed: { type: "number", minimum: .1, maximum: 1 }, durationMs: { type: "integer", minimum: 100, maximum: 5000 }, preset: STRING }, required: ["siteId", "cameraId", "command"], additionalProperties: false },
  update_camera_config: { type: "object", properties: { siteId: STRING, cameraId: STRING, config: { type: "object", minProperties: 1 } }, required: ["siteId", "cameraId", "config"], additionalProperties: false },
};

export function actionTools() {
  return Object.entries(AGENT_ACTIONS).map(([name, definition]) => ({ name, description: definition.description, parameters: ACTION_SCHEMAS[name] }));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateAgentAction(action, args = {}) {
  if (!AGENT_ACTIONS[action]) return `action không hợp lệ. Hỗ trợ: ${Object.keys(AGENT_ACTIONS).join(", ")}`;
  if (!args || typeof args !== "object" || Array.isArray(args)) return "args phải là object";
  const needsCamera = ["camera_status", "camera_config", "get_live_link", "get_snapshot_link", "inspect_camera_snapshot", "set_recording", "move_camera", "update_camera_config"].includes(action);
  if (needsCamera && (!nonEmpty(args.siteId) || !nonEmpty(args.cameraId))) return "siteId và cameraId là bắt buộc";
  if (action === "scan_cameras" && !nonEmpty(args.siteId)) return "siteId là bắt buộc";
  if (action === "add_camera") {
    if (!["siteId", "name", "ip", "username", "password"].every((key) => nonEmpty(args[key]))) return "siteId, name, ip, username và password là bắt buộc";
    for (const key of ["rtspPort", "onvifPort"]) if (args[key] !== undefined && (!Number.isInteger(Number(args[key])) || Number(args[key]) < 1 || Number(args[key]) > 65535)) return `${key} phải từ 1 đến 65535`;
  }
  if (action === "label_person" && !nonEmpty(args.personId)) return "personId là bắt buộc";
  if (action === "inspect_event_media" && !nonEmpty(args.eventId)) return "eventId là bắt buộc";
  if (action === "summarize_events" && (!nonEmpty(args.from) || !nonEmpty(args.to) || Number.isNaN(Date.parse(args.from)) || Number.isNaN(Date.parse(args.to)))) return "from và to phải là thời gian ISO hợp lệ";
  if (action === "summarize_events" && Date.parse(args.from) > Date.parse(args.to)) return "from không được sau to";
  if (action === "inspect_event_media" && !["image", "video"].includes(args.mediaType)) return "mediaType phải là image hoặc video";
  if (["inspect_camera_snapshot", "inspect_event_media"].includes(action) && args.question !== undefined && (typeof args.question !== "string" || args.question.length > 500)) return "question phải là chuỗi tối đa 500 ký tự";
  if (action === "label_person" && args.label !== null && typeof args.label !== "string") return "label phải là string hoặc null";
  if (action === "label_person" && typeof args.label === "string" && args.label.length > 100) return "label tối đa 100 ký tự";
  if (action === "set_recording" && typeof args.recordOnPerson !== "boolean") return "recordOnPerson phải là boolean";
  if (action === "move_camera" && !nonEmpty(args.command)) return "command là bắt buộc";
  if (action === "move_camera" && !["up", "down", "left", "right", "stop", "zoomIn", "zoomOut", "home", "gotoPreset", "setPreset"].includes(args.command)) return "command PTZ không hợp lệ";
  if (action === "move_camera" && args.speed !== undefined && (!Number.isFinite(Number(args.speed)) || Number(args.speed) < 0.1 || Number(args.speed) > 1)) return "speed phải từ 0.1 đến 1";
  if (action === "move_camera" && args.durationMs !== undefined && (!Number.isInteger(Number(args.durationMs)) || Number(args.durationMs) < 100 || Number(args.durationMs) > 5000)) return "durationMs phải từ 100 đến 5000";
  if (action === "update_camera_config" && (!args.config || typeof args.config !== "object" || Array.isArray(args.config) || !Object.keys(args.config).length)) return "config phải là object không rỗng";
  return null;
}

export function requiresAgentConfirmation(action) {
  return Boolean(AGENT_ACTIONS[action] && !AGENT_ACTIONS[action].readOnly);
}
