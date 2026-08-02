// Installs go2rtc + the relay as Windows Services using node-windows
// (wraps each Node script with a small EXE, registers it with SCM,
// auto-restarts on crash, starts on boot). Run as Administrator.
//
//   node win/install-services.js
const path = require("path");
const { Service } = require("node-windows");

function install(name, description, script) {
  const svc = new Service({ name, description, script });

  svc.on("install", () => {
    console.log(`✅ Đã cài + khởi động service: ${name}`);
    svc.start();
  });
  svc.on("alreadyinstalled", () => console.log(`⚠️ ${name} đã được cài trước đó.`));
  svc.on("error", (err) => console.error(`❌ Lỗi cài ${name}:`, err));

  svc.install();
}

install(
  "cameraaiwork-go2rtc",
  "go2rtc stream server for cameraaiwork",
  path.join(__dirname, "go2rtc-wrapper.js")
);

install(
  "cameraaiwork-relay",
  "cameraaiwork on-site relay (PTZ + motion webhook + tunnels)",
  path.join(__dirname, "..", "src", "index.js")
);
