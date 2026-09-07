const fs = require("fs");

function clean(value) {
  return String(value ?? "").trim();
}

function validateCamera(input, current) {
  const id = clean(input.id || current?.id);
  const ip = clean(input.ip ?? current?.onvif?.ip);
  const username = clean(input.username ?? current?.onvif?.username);
  const suppliedPassword = typeof input.password === "string" && input.password.length > 0;
  const password = suppliedPassword ? input.password : current?.onvif?.password;
  const onvifPort = Number(input.onvifPort ?? current?.onvif?.port ?? 2020);
  const rtspPort = Number(input.rtspPort ?? current?.rtsp?.port ?? 554);
  const rtspPath = clean(input.rtspPath ?? current?.rtsp?.path ?? "/stream1");

  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Mã camera không hợp lệ");
  if (!ip || ip.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(ip)) throw new Error("IP/hostname camera không hợp lệ");
  if (!username || username.length > 200) throw new Error("Tài khoản camera là bắt buộc");
  if (!password || String(password).length > 1024) throw new Error("Mật khẩu camera là bắt buộc");
  if (!Number.isInteger(onvifPort) || onvifPort < 1 || onvifPort > 65535) throw new Error("Cổng ONVIF không hợp lệ");
  if (!Number.isInteger(rtspPort) || rtspPort < 1 || rtspPort > 65535) throw new Error("Cổng RTSP không hợp lệ");
  if (!rtspPath.startsWith("/") || /[\r\n?#]/.test(rtspPath) || rtspPath.length > 300) throw new Error("Đường dẫn RTSP không hợp lệ");

  return {
    id,
    stream: id,
    onvif: { ip, port: onvifPort, username, password: String(password) },
    rtsp: { port: rtspPort, path: rtspPath },
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
    hasPassword: Boolean(camera.onvif.password),
  };
}

function sourceUrls(camera) {
  const user = encodeURIComponent(camera.onvif.username);
  const pass = encodeURIComponent(camera.onvif.password);
  return [
    `rtsp://${user}:${pass}@${camera.onvif.ip}:${camera.rtsp.port}${camera.rtsp.path}`,
    `onvif://${user}:${pass}@${camera.onvif.ip}:${camera.onvif.port}#backchannel=0`,
  ];
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

module.exports = { validateCamera, publicCamera, sourceUrls, updateGo2rtc, persistCameras };
