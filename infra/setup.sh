#!/usr/bin/env bash
# One-time setup per site: downloads the go2rtc binary for this machine's
# platform and renders infra/go2rtc/go2rtc.yaml from apps/relay/cameras.json
# (credentials never committed — see apps/relay/cameras.json.example).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/infra/go2rtc/bin"
mkdir -p "$BIN_DIR"

# --- 1. Download go2rtc (not committed to git, platform-specific binary) ---
os="$(uname -s)"
arch="$(uname -m)"

case "$os-$arch" in
  Darwin-arm64) asset="go2rtc_mac_arm64"; ext=".zip" ;;
  Darwin-x86_64) asset="go2rtc_mac_amd64"; ext=".zip" ;;
  Linux-x86_64) asset="go2rtc_linux_amd64"; ext="" ;;
  Linux-aarch64) asset="go2rtc_linux_arm64"; ext="" ;;
  *) echo "Unsupported platform: $os-$arch" >&2; exit 1 ;;
esac

echo "==> Downloading latest go2rtc (${asset}${ext})..."
url=$(curl -fsSL https://api.github.com/repos/AlexxIT/go2rtc/releases/latest \
  | grep "browser_download_url.*/${asset}${ext}\"" \
  | head -1 \
  | cut -d '"' -f 4)

if [ -z "$url" ]; then
  echo "Could not resolve download URL for ${asset}${ext}. Check https://github.com/AlexxIT/go2rtc/releases manually." >&2
  exit 1
fi

if [ "$ext" = ".zip" ]; then
  curl -fsSL "$url" -o "$BIN_DIR/go2rtc.zip"
  unzip -o -q "$BIN_DIR/go2rtc.zip" -d "$BIN_DIR"
  rm "$BIN_DIR/go2rtc.zip"
else
  curl -fsSL "$url" -o "$BIN_DIR/go2rtc"
fi
chmod +x "$BIN_DIR/go2rtc"
echo "==> go2rtc installed at $BIN_DIR/go2rtc"

# --- 2. Render go2rtc.yaml from apps/relay/cameras.json ---
if [ ! -f "$ROOT_DIR/apps/relay/cameras.json" ]; then
  echo "!! No apps/relay/cameras.json found. Copy cameras.json.example -> cameras.json and fill in camera credentials first." >&2
  exit 1
fi

node "$ROOT_DIR/infra/go2rtc/render-config.js"

echo "==> Setup done. Run: $BIN_DIR/go2rtc -config $ROOT_DIR/infra/go2rtc/go2rtc.yaml"
