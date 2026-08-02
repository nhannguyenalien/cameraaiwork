// Two ways to expose go2rtc + the relay publicly:
//
// - Named tunnel (preferred): the backend provisions this server-side via
//   the Cloudflare API (see apps/pages/functions/_lib/cloudflareTunnel.js)
//   on our own domain, with a stable hostname known before the relay even
//   starts. Just needs `cloudflared tunnel run --token <token>`.
// - Quick Tunnel (fallback, e.g. no CLOUDFLARE_TUNNEL_TOKEN configured):
//   no Cloudflare account needed, a public HTTPS URL in a few seconds, but
//   the hostname changes every restart so the relay has to self-report it
//   (see reportTunnelUrls in index.js).
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

function startNamedTunnel(tunnelToken) {
  const proc = spawn(CLOUDFLARED_BIN, ["tunnel", "run", "--token", tunnelToken]);

  const logChunk = (chunk) => {
    // cloudflared is fairly chatty; only surface actual problems.
    const text = chunk.toString();
    if (/error|fail/i.test(text)) console.error(`⚠️ cloudflared: ${text.trim()}`);
  };
  proc.stdout.on("data", logChunk);
  proc.stderr.on("data", logChunk);

  proc.on("exit", (code) => {
    console.error(`⚠️ Named tunnel thoát (code ${code}), khởi động lại sau 5s`);
    setTimeout(() => startNamedTunnel(tunnelToken), 5000);
  });

  return proc;
}

module.exports = { startQuickTunnel, startNamedTunnel };
