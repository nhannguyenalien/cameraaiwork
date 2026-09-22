const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCamera, publicCamera, sameRtspSource, sourceUrls, missingStreamIds } = require("../src/camera-config");

test("keeps the local password when an edit submits an empty password", () => {
  const current = { id: "cam1", onvif: { ip: "192.168.1.2", port: 2020, username: "old", password: "secret" }, rtsp: { port: 554, path: "/stream1" } };
  const updated = validateCamera({ id: "cam1", ip: "192.168.1.3", username: "new", password: "" }, current);
  assert.equal(updated.onvif.password, "secret");
  assert.equal(updated.onvif.ip, "192.168.1.3");
  assert.equal(publicCamera(updated).password, undefined);
  assert.equal(publicCamera(updated).hasPassword, true);
});

test("encodes credentials in go2rtc source URLs", () => {
  const camera = validateCamera({ id: "cam1", ip: "camera.lan", username: "a@b", password: "p:a@ss", rtspPort: 8554, rtspPath: "/live", onvifPort: 2020 });
  const [rtsp] = sourceUrls(camera);
  assert.equal(rtsp, "rtsp://a%40b:p%3Aa%40ss@camera.lan:8554/live");
  assert.equal(sourceUrls(camera).length, 1);
});

test("only enables ONVIF as a video fallback when explicitly requested", () => {
  const camera = validateCamera({ id: "cam1", ip: "camera.lan", username: "u", password: "p", onvifStream: true });
  assert.equal(sourceUrls(camera).length, 2);
  assert.match(sourceUrls(camera)[1], /^onvif:\/\//);
  assert.equal(publicCamera(camera).onvifStream, true);
});

test("identifies duplicate RTSP sources independently of camera name", () => {
  const first = validateCamera({ id: "first", ip: "192.168.1.252", username: "u", password: "p", rtspPath: "/cam/realmonitor?channel=7&subtype=0" });
  const duplicate = validateCamera({ id: "second", ip: "192.168.1.252", username: "u2", password: "p2", rtspPath: "/cam/realmonitor?channel=7&subtype=0" });
  const distinct = validateCamera({ id: "third", ip: "192.168.1.252", username: "u", password: "p", rtspPath: "/cam/realmonitor?channel=8&subtype=0" });
  assert.equal(sameRtspSource(first, duplicate), true);
  assert.equal(sameRtspSource(first, distinct), false);
});

test("supports legacy camera entries without an rtsp block", () => {
  const legacy = { id: "legacy", onvif: { ip: "192.168.1.32", port: 2020, username: "u", password: "p" } };
  assert.equal(sourceUrls(legacy)[0], "rtsp://u:p@192.168.1.32:554/stream1");
  assert.equal(publicCamera(legacy).localAiEnabled, true);
});

test("persists a per-camera local AI switch", () => {
  const disabled = validateCamera({ id: "cam1", ip: "camera.lan", username: "u", password: "p", localAiEnabled: false });
  assert.equal(disabled.localAiEnabled, false);
  assert.equal(publicCamera(disabled).localAiEnabled, false);
  assert.equal(validateCamera({ username: "u2" }, disabled).localAiEnabled, false);
  assert.equal(validateCamera({ localAiEnabled: true }, disabled).localAiEnabled, true);
  assert.throws(() => validateCamera({ localAiEnabled: "false" }, disabled), /true hoặc false/);
});

test("persists a per-camera ONVIF-motion-trusted switch, defaulting to false", () => {
  const camera = validateCamera({ id: "cam1", ip: "camera.lan", username: "u", password: "p" });
  assert.equal(camera.onvifMotionTrusted, false);
  assert.equal(publicCamera(camera).onvifMotionTrusted, false);

  const trusted = validateCamera({ id: "cam1", ip: "camera.lan", username: "u", password: "p", onvifMotionTrusted: true });
  assert.equal(trusted.onvifMotionTrusted, true);
  assert.equal(publicCamera(trusted).onvifMotionTrusted, true);
  assert.equal(validateCamera({ username: "u2" }, trusted).onvifMotionTrusted, true);
  assert.equal(validateCamera({ onvifMotionTrusted: false }, trusted).onvifMotionTrusted, false);
  assert.throws(() => validateCamera({ onvifMotionTrusted: "true" }, trusted), /true hoặc false/);
});

test("persists a per-camera hasOnvif switch, defaulting to true", () => {
  const camera = validateCamera({ id: "cam1", ip: "camera.lan", username: "u", password: "p" });
  assert.equal(camera.hasOnvif, true);
  assert.equal(publicCamera(camera).hasOnvif, true);

  const noOnvif = validateCamera({ id: "cam1", ip: "camera.lan", username: "u", password: "p", hasOnvif: false });
  assert.equal(noOnvif.hasOnvif, false);
  assert.equal(publicCamera(noOnvif).hasOnvif, false);
  assert.equal(validateCamera({ username: "u2" }, noOnvif).hasOnvif, false);
  assert.equal(validateCamera({ hasOnvif: true }, noOnvif).hasOnvif, true);
  assert.throws(() => validateCamera({ hasOnvif: "false" }, noOnvif), /true hoặc false/);
});

test("finds only configured streams missing after a go2rtc restart", () => {
  const cameras = [{ id: "cam1" }, { id: "cam2" }, { id: "cam3" }];
  assert.deepEqual(missingStreamIds(cameras, { cam1: { producers: [] }, cam3: {} }), ["cam2"]);
  assert.deepEqual(missingStreamIds(cameras, {}), ["cam1", "cam2", "cam3"]);
  assert.deepEqual(missingStreamIds(cameras, null), ["cam1", "cam2", "cam3"]);
});

test("rejects unsafe hosts and paths", () => {
  assert.throws(() => validateCamera({ id: "cam1", ip: "http://bad", username: "u", password: "p" }), /IP\/hostname/);
  assert.throws(() => validateCamera({ id: "cam1", ip: "192.168.1.2", username: "u", password: "p", rtspPath: "stream1" }), /RTSP/);
  assert.throws(() => validateCamera({ id: "cam1", ip: "192.168.1.2", username: "u", password: "p", rtspPath: "/live#fragment" }), /RTSP/);
  assert.throws(() => validateCamera({ id: "cam1", ip: "192.168.1.2", username: "u", password: "p", rtspPath: "/live\r\nInjected" }), /RTSP/);
});

test("accepts Dahua RTSP channel query parameters", () => {
  const camera = validateCamera({
    id: "cam2",
    ip: "192.168.1.252",
    username: "admin",
    password: "secret",
    rtspPort: 554,
    rtspPath: "/cam/realmonitor?channel=2&subtype=0",
    onvifPort: 80,
  });
  assert.equal(camera.rtsp.path, "/cam/realmonitor?channel=2&subtype=0");
  assert.equal(sourceUrls(camera)[0], "rtsp://admin:secret@192.168.1.252:554/cam/realmonitor?channel=2&subtype=0");
});
