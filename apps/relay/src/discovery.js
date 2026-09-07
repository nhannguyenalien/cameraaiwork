const { Cam, Discovery } = require("onvif");

let activeProbe = null;
// Some cameras return malformed WS-Discovery XML. The library emits an
// EventEmitter error as well as reporting it to the probe callback; keeping a
// listener prevents one bad LAN device from terminating the relay process.
Discovery.on("error", (error) => console.warn("⚠️ Phản hồi ONVIF discovery không hợp lệ:", error?.message || error));

function publicDevice(cam) {
  const xaddr = cam?.xaddrs?.[0];
  return {
    ip: String(cam?.hostname || xaddr?.hostname || ""),
    onvifPort: Number(cam?.port || xaddr?.port || (xaddr?.protocol === "https:" ? 443 : 80)),
    onvifPath: String(cam?.path || xaddr?.pathname || "/onvif/device_service"),
    urn: String(cam?.urn || ""),
  };
}

function discoverCameras(timeout = 5000) {
  if (activeProbe) return activeProbe;
  activeProbe = new Promise((resolve, reject) => {
    Discovery.probe({ timeout: Math.min(Math.max(Number(timeout) || 5000, 2000), 8000) }, (error, cameras = []) => {
      const devices = cameras.map(publicDevice).filter((camera) => camera.ip);
      if (error && !devices.length) reject(error);
      else resolve([...new Map(devices.map((camera) => [`${camera.ip}:${camera.onvifPort}`, camera])).values()]);
    });
  }).finally(() => { activeProbe = null; });
  return activeProbe;
}

function resolveRtsp({ ip, onvifPort, username, password }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Camera không phản hồi ONVIF")), 10000);
    const finish = (error, value) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    new Cam({ hostname: ip, port: onvifPort, username, password, timeout: 8000 }, function (error) {
      if (error) return finish(new Error("Không đăng nhập được camera bằng tài khoản đã nhập"));
      this.getStreamUri({ protocol: "RTSP" }, (streamError, result) => {
        if (streamError || !result?.uri) return finish(new Error("Camera không cung cấp luồng RTSP qua ONVIF"));
        try {
          const uri = new URL(result.uri);
          finish(null, {
            ip: uri.hostname || ip,
            rtspPort: Number(uri.port || 554),
            rtspPath: `${uri.pathname || "/"}${uri.search || ""}`,
          });
        } catch {
          finish(new Error("Camera trả về địa chỉ RTSP không hợp lệ"));
        }
      });
    });
  });
}

module.exports = { discoverCameras, publicDevice, resolveRtsp };
