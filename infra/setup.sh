#!/usr/bin/env bash
# One-time setup per site: downloads the go2rtc binary for this machine's
# platform and renders infra/go2rtc/go2rtc.yaml from apps/relay/cameras.json
# (credentials never committed — see apps/relay/cameras.json.example).
set -euo pipefail
umask 077

GO2RTC_VERSION="1.9.14"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/infra/go2rtc/bin"
mkdir -p "$BIN_DIR"

# --- 1. Download go2rtc (not committed to git, platform-specific binary) ---
os="$(uname -s)"
arch="$(uname -m)"

case "$os-$arch" in
  Darwin-arm64) asset="go2rtc_mac_arm64"; ext=".zip"; expected_sha256="919b78adc759d6b3883d1e1b2ac915ac0985bb903ff1897b4d228527bd64690c" ;;
  Darwin-x86_64) asset="go2rtc_mac_amd64"; ext=".zip"; expected_sha256="9b0b9a27a4dc3a5b8b93376e7e8fc2787c6af624a512842622be84aec0171c7a" ;;
  Linux-x86_64) asset="go2rtc_linux_amd64"; ext=""; expected_sha256="32d616af226bd731678ffde328b94cfb94e30339bfefc469cfb76323144615a6" ;;
  Linux-aarch64) asset="go2rtc_linux_arm64"; ext=""; expected_sha256="359fabade8a7a51e81a55fe6df6b0ef81764a5e1d63179577534eaaa71904b50" ;;
  *) echo "Unsupported platform: $os-$arch" >&2; exit 1 ;;
esac

echo "==> Downloading pinned go2rtc v${GO2RTC_VERSION} (${asset}${ext})..."
url="https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/${asset}${ext}"
download_path="$BIN_DIR/${asset}${ext}"
curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$download_path"
if command -v sha256sum >/dev/null 2>&1; then actual_sha256="$(sha256sum "$download_path" | awk '{print $1}')"
else actual_sha256="$(shasum -a 256 "$download_path" | awk '{print $1}')"; fi
[[ "$actual_sha256" == "$expected_sha256" ]] || { echo "SHA-256 mismatch for go2rtc" >&2; exit 1; }

if [ "$ext" = ".zip" ]; then
  unzip -o -q "$download_path" -d "$BIN_DIR"
  rm "$download_path"
else
  mv "$download_path" "$BIN_DIR/go2rtc"
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
