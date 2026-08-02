// Windows has no launchd/systemd equivalent for supervising an arbitrary
// binary. node-windows only knows how to wrap a Node.js script as a
// service, so this tiny wrapper spawns go2rtc.exe as a child process and
// restarts it on exit — the same Restart=always behavior as the
// macOS/Linux service files, just implemented in JS instead of declared
// in a service unit.
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const bin = path.join(repoRoot, "infra", "go2rtc", "bin", "go2rtc.exe");
const configPath = path.join(repoRoot, "infra", "go2rtc", "go2rtc.yaml");

function start() {
  const proc = spawn(bin, ["-config", configPath], { stdio: "inherit" });
  proc.on("exit", (code) => {
    console.error(`go2rtc thoát (code ${code}), khởi động lại sau 5s`);
    setTimeout(start, 5000);
  });
}

start();
