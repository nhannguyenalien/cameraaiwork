const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCamera, publicCamera, sourceUrls } = require("../src/camera-config");

test("keeps the local password when an edit submits an empty password", () => {
  const current = { id: "cam1", onvif: { ip: "192.168.1.2", port: 2020, username: "old", password: "secret" }, rtsp: { port: 554, path: "/stream1" } };
  const updated = validateCamera({ id: "cam1", ip: "192.168.1.3", username: "new", password: "" }, current);
  assert.equal(updated.onvif.password, "secret");
  assert.equal(updated.onvif.ip, "192.168.1.3");
  assert.equal(publicCamera(updated).password, "secret");
  assert.equal(publicCamera(updated).hasPassword, true);
});

test("encodes credentials in go2rtc source URLs", () => {
  const camera = validateCamera({ id: "cam1", ip: "camera.lan", username: "a@b", password: "p:a@ss", rtspPort: 8554, rtspPath: "/live", onvifPort: 2020 });
  const [rtsp, onvif] = sourceUrls(camera);
  assert.equal(rtsp, "rtsp://a%40b:p%3Aa%40ss@camera.lan:8554/live");
  assert.match(onvif, /^onvif:\/\/a%40b:p%3Aa%40ss@camera\.lan:2020/);
});

test("rejects unsafe hosts and paths", () => {
  assert.throws(() => validateCamera({ id: "cam1", ip: "http://bad", username: "u", password: "p" }), /IP\/hostname/);
  assert.throws(() => validateCamera({ id: "cam1", ip: "192.168.1.2", username: "u", password: "p", rtspPath: "stream1" }), /RTSP/);
});
