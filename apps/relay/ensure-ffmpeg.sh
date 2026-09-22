#!/usr/bin/env bash
set -euo pipefail

ffmpeg_major() {
  ffmpeg -version 2>/dev/null | awk 'NR == 1 { sub(/^n/, "", $3); split($3, v, "."); print v[1] + 0 }'
}

if command -v ffmpeg >/dev/null 2>&1 && [[ "$(ffmpeg_major)" -ge 5 ]]; then
  exit 0
fi

if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  echo "==> Cài FFmpeg hiện đại cho audio/talkback camera"
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT
  asset="ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz"
  release="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
  curl --proto '=https' --tlsv1.2 -fsSL "$release/$asset" -o "$temp_dir/$asset"
  curl --proto '=https' --tlsv1.2 -fsSL "$release/checksums.sha256" -o "$temp_dir/checksums.sha256"
  (cd "$temp_dir" && grep " $asset$" checksums.sha256 | sha256sum -c -)
  tar -xJf "$temp_dir/$asset" -C "$temp_dir"
  bin_dir="$(find "$temp_dir" -type d -path '*/bin' | head -1)"
  [[ -x "$bin_dir/ffmpeg" && -x "$bin_dir/ffprobe" ]]
  sudo install -m 0755 "$bin_dir/ffmpeg" /usr/local/bin/ffmpeg
  sudo install -m 0755 "$bin_dir/ffprobe" /usr/local/bin/ffprobe
elif [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
  brew install ffmpeg
else
  echo "Lỗi: cần FFmpeg 5+ để phát âm thanh qua camera." >&2
  exit 1
fi

[[ "$(ffmpeg_major)" -ge 5 ]] || { echo "Lỗi: FFmpeg sau cài đặt vẫn quá cũ." >&2; exit 1; }
