const { Cam, Discovery } = require("onvif");
const net = require("net");
const os = require("os");

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

function lanPrefixes(interfaces = os.networkInterfaces()) {
  const prefixes = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (/^(docker|br-|veth|tailscale|lo)/.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) continue;
      const parts = address.address.split(".").map(Number);
      const privateIp = parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
      if (privateIp) prefixes.push(parts.slice(0, 3).join("."));
    }
  }
  return [...new Set(prefixes)];
}

function portOpen(ip, port, timeout = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function scanLan() {
  const ports = [2020, 80, 443, 8000, 8080, 8899, 554];
  const jobs = [];
  for (const prefix of lanPrefixes()) {
    for (let host = 1; host < 255; host += 1) jobs.push({ ip: `${prefix}.${host}` });
  }
  let cursor = 0;
  const found = [];
  await Promise.all(Array.from({ length: Math.min(64, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      for (const port of ports) {
        if (await portOpen(job.ip, port)) {
          found.push({ ip: job.ip, onvifPort: port, onvifPath: "/onvif/device_service", urn: "", detectedBy: "ip-scan" });
          break;
        }
      }
    }
  }));
  return found;
}

async function discoverAll() {
  const [onvifResult, scanResult] = await Promise.allSettled([discoverCameras(), scanLan()]);
  const onvif = onvifResult.status === "fulfilled" ? onvifResult.value.map((item) => ({ ...item, detectedBy: "onvif" })) : [];
  const scan = scanResult.status === "fulfilled" ? scanResult.value : [];
  const merged = new Map(scan.map((item) => [item.ip, item]));
  for (const item of onvif) merged.set(item.ip, item);
  return [...merged.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
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

module.exports = { discoverAll, discoverCameras, lanPrefixes, publicDevice, resolveRtsp, scanLan };
