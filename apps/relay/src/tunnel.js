// Cloudflare Quick Tunnels — no Cloudflare account needed on the customer's
// side, no port forwarding, a public HTTPS URL within a few seconds. The
// tradeoff: the hostname changes every time cloudflared (re)starts, so the
// caller must re-report it (see registerTunnels in index.js). Good enough
// for onboarding; a named tunnel (stable hostname, provisioned centrally
// via the Cloudflare API) is the natural upgrade once this needs to be
// rock-solid production infra rather than "customer just installed it".
const { spawn } = require("child_process");

const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

// On macOS/Linux the installer puts cloudflared on PATH (brew, or
// /usr/local/bin), so "cloudflared" resolves on its own. Windows has no
// such convention, so install.ps1 downloads it into infra/ and points this
// at the full path via CLOUDFLARED_BIN in .env.
const CLOUDFLARED_BIN = process.env.CLOUDFLARED_BIN || "cloudflared";

function startQuickTunnel(label, port, onUrl) {
  const proc = spawn(CLOUDFLARED_BIN, ["tunnel", "--url", `http://localhost:${port}`]);
  let matched = false;

  const handleChunk = (chunk) => {
    if (matched) return;
    const match = chunk.toString().match(URL_RE);
    if (match) {
      matched = true;
      console.log(`✅ Tunnel ${label} sẵn sàng: ${match[0]}`);
      onUrl(match[0]);
    }
  };

  proc.stdout.on("data", handleChunk);
  proc.stderr.on("data", handleChunk); // cloudflared logs to stderr by default

  proc.on("exit", (code) => {
    console.error(`⚠️ Tunnel ${label} thoát (code ${code}), khởi động lại sau 5s`);
    setTimeout(() => startQuickTunnel(label, port, onUrl), 5000);
  });

  return proc;
}

module.exports = { startQuickTunnel };
