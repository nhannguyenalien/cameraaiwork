// The backend provisions one named tunnel/site. It targets the relay only;
// go2rtc remains on localhost behind the relay's signed/authenticated proxy.
const { spawn } = require("child_process");

// On macOS/Linux the installer puts cloudflared on PATH (brew, or
// /usr/local/bin), so "cloudflared" resolves on its own. Windows has no
// such convention, so install.ps1 downloads it into infra/ and points this
// at the full path via CLOUDFLARED_BIN in .env.
const CLOUDFLARED_BIN = process.env.CLOUDFLARED_BIN || "cloudflared";

function startNamedTunnel(tunnelToken) {
  // cloudflared accepts TUNNEL_TOKEN from the environment. Keeping the token
  // out of argv prevents it from appearing in ps/systemctl status output.
  const proc = spawn(CLOUDFLARED_BIN, ["tunnel", "run"], {
    env: { ...process.env, TUNNEL_TOKEN: tunnelToken },
  });

  const logChunk = (chunk) => {
    // cloudflared is fairly chatty; only surface actual problems.
    const text = chunk.toString();
    if (/error|fail/i.test(text)) console.error(`⚠️ cloudflared: ${text.trim()}`);
  };
  proc.stdout.on("data", logChunk);
  proc.stderr.on("data", logChunk);

  // A missing/broken cloudflared binary must not crash the relay. Motion
  // detection and local recording can keep running while the tunnel retries.
  proc.on("error", (err) => {
    console.error(`⚠️ Không khởi động được named tunnel: ${err.message}`);
  });

  proc.on("close", (code) => {
    console.error(`⚠️ Named tunnel thoát (code ${code}), khởi động lại sau 5s`);
    setTimeout(() => startNamedTunnel(tunnelToken), 5000);
  });

  return proc;
}

module.exports = { startNamedTunnel };
