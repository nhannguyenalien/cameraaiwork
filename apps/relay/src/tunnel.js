// Cloudflare Quick Tunnels — no Cloudflare account needed on the customer's
// side, no port forwarding, a public HTTPS URL within a few seconds. The
// tradeoff: the hostname changes every time cloudflared (re)starts, so the
// caller must re-report it (see registerTunnels in index.js). Good enough
// for onboarding; a named tunnel (stable hostname, provisioned centrally
// via the Cloudflare API) is the natural upgrade once this needs to be
// rock-solid production infra rather than "customer just installed it".
const { spawn } = require("child_process");

const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

function startQuickTunnel(label, port, onUrl) {
  const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`]);
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
