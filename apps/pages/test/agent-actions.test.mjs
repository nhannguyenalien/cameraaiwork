import assert from "node:assert/strict";
import test from "node:test";
import { actionCatalog, actionTools, requiresAgentConfirmation, validateAgentAction } from "../functions/_lib/agentActions.js";
import { onRequestPost } from "../functions/api/agent/actions.js";

test("agent action catalog identifies read and write operations", () => {
  const catalog = actionCatalog();
  assert.equal(catalog.find((item) => item.name === "camera_status").requiresConfirmation, false);
  assert.equal(catalog.find((item) => item.name === "move_camera").requiresConfirmation, true);
  assert.equal(catalog.find((item) => item.name === "scan_cameras").requiresConfirmation, false);
  assert.equal(catalog.find((item) => item.name === "add_camera").requiresConfirmation, true);
  assert.equal(catalog.find((item) => item.name === "inspect_event_media").requiresConfirmation, false);
  assert.equal(catalog.find((item) => item.name === "summarize_events").requiresConfirmation, false);
  assert.equal(requiresAgentConfirmation("label_person"), true);
});

test("agent tools expose provider-neutral JSON schemas", () => {
  const tools = actionTools();
  const addCamera = tools.find((item) => item.name === "add_camera");
  assert.ok(addCamera.parameters.required.includes("password"));
  assert.equal(addCamera.parameters.properties.autoConfigure.type, "boolean");
});

test("agent action validation requires scoped camera identifiers", () => {
  assert.equal(validateAgentAction("camera_status", {}), "siteId và cameraId là bắt buộc");
  assert.equal(validateAgentAction("camera_status", { siteId: "site-1", cameraId: "cam-1" }), null);
  assert.equal(validateAgentAction("scan_cameras", {}), "siteId là bắt buộc");
  assert.equal(validateAgentAction("inspect_camera_snapshot", { siteId: "site-1", cameraId: "cam-1" }), null);
  assert.equal(validateAgentAction("inspect_event_media", { eventId: "evt-1", mediaType: "audio" }), "mediaType phải là image hoặc video");
  assert.equal(validateAgentAction("summarize_events", { from: "2026-09-09T00:00:00+07:00", to: "2026-09-09T10:00:00+07:00" }), null);
  assert.match(validateAgentAction("summarize_events", { from: "sáng nay", to: "now" }), /ISO hợp lệ/);
});

test("agent action validation protects mutating payloads", () => {
  assert.equal(validateAgentAction("set_recording", { siteId: "site-1", cameraId: "cam-1", recordOnPerson: "yes" }), "recordOnPerson phải là boolean");
  assert.equal(validateAgentAction("update_camera_config", { siteId: "site-1", cameraId: "cam-1", config: {} }), "config phải là object không rỗng");
  assert.match(validateAgentAction("delete_everything", {}), /action không hợp lệ/);
  assert.match(validateAgentAction("add_camera", { siteId: "site-1" }), /username và password/);
  assert.equal(validateAgentAction("add_camera", { siteId: "site-1", name: "Cổng", ip: "192.168.1.20", username: "admin", password: "secret", rtspPort: 70000 }), "rtspPort phải từ 1 đến 65535");
});

test("state-changing agent action returns an exact confirmation proposal", async () => {
  const payload = { action: "move_camera", args: { siteId: "site-1", cameraId: "cam-1", command: "left", durationMs: 500 } };
  const response = await onRequestPost({
    request: new Request("https://example.test/api/agent/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    env: {}, data: { accountId: "acct-1" }, params: {},
  });
  assert.equal(response.status, 428);
  assert.deepEqual(await response.json(), {
    error: "Thao tác này cần xác nhận trước khi thực thi",
    requiresConfirmation: true,
    proposal: payload,
  });
});
