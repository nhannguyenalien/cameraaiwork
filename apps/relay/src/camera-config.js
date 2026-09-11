const fs = require("fs");

function clean(value) {
  return String(value ?? "").trim();
}

function validateCamera(input, current) {
  if (input.localAiEnabled != null && typeof input.localAiEnabled !== "boolean") {
    throw new Error("Trạng thái AI local phải là true hoặc false");
  }
  if (input.onvifMotionTrusted != null && typeof input.onvifMotionTrusted !== "boolean") {
    throw new Error("Trạng thái tin cậy ONVIF motion phải là true hoặc false");
  }
  const id = clean(input.id || current?.id);
  const ip = clean(input.ip ?? current?.onvif?.ip);
  const username = clean(input.username ?? current?.onvif?.username);
  const suppliedPassword = typeof input.password === "string" && input.password.length > 0;
  const password = suppliedPassword ? input.password : current?.onvif?.password;
  const onvifPort = Number(input.onvifPort ?? current?.onvif?.port ?? 2020);
  const rtspPort = Number(input.rtspPort ?? current?.rtsp?.port ?? 554);
  const rtspPath = clean(input.rtspPath ?? current?.rtsp?.path ?? "/stream1");
  const onvifStream = input.onvifStream === true || (input.onvifStream == null && current?.onvif?.stream === true);
  const localAiEnabled = input.localAiEnabled == null
    ? current?.localAiEnabled !== false
    : input.localAiEnabled === true;
  // Opt-in per camera: only cameras with a proven-reliable ONVIF motion feed
  // (no false triggers from light/noise) should skip AI confirmation.
  // Defaults to false so existing/new cameras keep the AI-gated behavior.
  const onvifMotionTrusted = input.onvifMotionTrusted == null
    ? current?.onvifMotionTrusted === true
    : input.onvifMotionTrusted === true;

  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Mã camera không hợp lệ");
  if (!ip || ip.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(ip)) throw new Error("IP/hostname camera không hợp lệ");
  if (!username || username.length > 200) throw new Error("Tài khoản camera là bắt buộc");
  if (!password || String(password).length > 1024) throw new Error("Mật khẩu camera là bắt buộc");
  if (!Number.isInteger(onvifPort) || onvifPort < 1 || onvifPort > 65535) throw new Error("Cổng ONVIF không hợp lệ");
  if (!Number.isInteger(rtspPort) || rtspPort < 1 || rtspPort > 65535) throw new Error("Cổng RTSP không hợp lệ");
  if (!rtspPath.startsWith("/") || /[\r\n#]/.test(rtspPath) || rtspPath.length > 300) throw new Error("Đường dẫn RTSP không hợp lệ");

  return {
    id,
    stream: id,
    // ONVIF is still retained for PTZ/events. It is deliberately not a video
    // fallback unless explicitly enabled: multiple logical channels on one
    // NVR share an ONVIF endpoint, which often returns channel 1 for all of
    // them and makes distinct RTSP channels appear duplicated.
    onvif: { ip, port: onvifPort, username, password: String(password), stream: onvifStream },
    rtsp: { port: rtspPort, path: rtspPath },
    localAiEnabled,
    onvifMotionTrusted,
  };
}

function publicCamera(camera) {
  return {
    id: camera.id,
    ip: camera.onvif.ip,
    username: camera.onvif.username,
    onvifPort: camera.onvif.port,
    rtspPort: camera.rtsp?.port || 554,
    rtspPath: camera.rtsp?.path || "/stream1",
    onvifStream: camera.onvif?.stream === true,
    localAiEnabled: camera.localAiEnabled !== false,
    onvifMotionTrusted: camera.onvifMotionTrusted === true,
    hasPassword: Boolean(camera.onvif.password),
  };
}

function sourceUrls(camera) {
  const user = encodeURIComponent(camera.onvif.username);
  const pass = encodeURIComponent(camera.onvif.password);
  const rtspPort = camera.rtsp?.port || 554;
  const rtspPath = camera.rtsp?.path || "/stream1";
  const sources = [`rtsp://${user}:${pass}@${camera.onvif.ip}:${rtspPort}${rtspPath}`];
  if (camera.onvif.stream === true) {
    sources.push(`onvif://${user}:${pass}@${camera.onvif.ip}:${camera.onvif.port}#backchannel=0`);
  }
  return sources;
}

function sameRtspSource(left, right) {
  return left?.onvif?.ip === right?.onvif?.ip
    && Number(left?.rtsp?.port || 554) === Number(right?.rtsp?.port || 554)
    && (left?.rtsp?.path || "/stream1") === (right?.rtsp?.path || "/stream1");
}

async function updateGo2rtc(go2rtcUrl, camera) {
  const request = async (method, params) => {
    const url = new URL("/api/streams", go2rtcUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { method });
    if (!response.ok) throw new Error(`go2rtc HTTP ${response.status}`);
  };
  await request("DELETE", { src: camera.id }).catch(() => {});
  for (const src of sourceUrls(camera)) await request("PATCH", { name: camera.id, src });
}

function persistCameras(file, cameras) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(cameras, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

module.exports = { validateCamera, publicCamera, sameRtspSource, sourceUrls, updateGo2rtc, persistCameras };
