// Removes the Windows Services installed by install-services.js. Run as
// Administrator.
//
//   node win/uninstall-services.js
const path = require("path");
const { Service } = require("node-windows");

function uninstall(name, script) {
  const svc = new Service({ name, script });
  svc.on("uninstall", () => console.log(`✅ Đã gỡ service: ${name}`));
  svc.on("error", (err) => console.error(`❌ Lỗi gỡ ${name}:`, err));
  svc.uninstall();
}

uninstall("cameraaiwork-go2rtc", path.join(__dirname, "go2rtc-wrapper.js"));
uninstall("cameraaiwork-relay", path.join(__dirname, "..", "src", "index.js"));
