#!/usr/bin/env bash
set -euo pipefail

# Safe in-place updater for an already claimed cameraaiwork site.
# It never runs install/claim and never replaces .env or cameras.json.
#
# Run only this checked-in local script after reviewing the release notes.
# For a custom install directory:
#   CAMERAAIWORK_DIR=/opt/cameraaiwork ./apps/relay/update.sh

API_BASE="${CAMERAAIWORK_API:-https://camera.schoolsai.work}"
BUNDLE_URL="${CAMERAAIWORK_BUNDLE_URL:-$API_BASE/cameraaiwork-relay.tar.gz}"
# systemd services do not necessarily receive HOME. Keep the default safe even
# when CAMERAAIWORK_DIR (the normal Linux service path) is supplied separately.
DEFAULT_INSTALL_DIR="${HOME:-/opt}/cameraaiwork"

if [[ -n "${CAMERAAIWORK_DIR:-}" ]]; then
  INSTALL_DIR="$CAMERAAIWORK_DIR"
elif [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  LOCAL_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || true)"
  if [[ -f "$LOCAL_ROOT/apps/relay/package.json" ]]; then
    INSTALL_DIR="$LOCAL_ROOT"
  else
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
  fi
else
  INSTALL_DIR="$DEFAULT_INSTALL_DIR"
fi

# Status file the relay's /update/status endpoint reads (dashboard "push
# update" button polls this) — must survive the relay process restarting
# partway through this script, so it's a plain file, not in-memory state.
STATUS_FILE="$INSTALL_DIR/apps/relay/.update-status.json"
LAST_ERROR=""

# Re-invocation used on Linux to survive `systemctl restart` on the relay's
# own unit — see the Linux branch of the restart step below.
POST_RESTART=false
[[ "${1:-}" == "--post-restart" ]] && POST_RESTART=true

write_status() {
  local status="$1" message="$2" escaped
  escaped="$(printf '%s' "$message" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')"
  mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null || true
  printf '{"status":"%s","finishedAt":"%s","message":"%s"}\n' \
    "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$escaped" > "$STATUS_FILE" 2>/dev/null || true
}

on_exit() {
  local code=$?
  # A second `trap ... EXIT` later in the script (e.g. temp-dir cleanup)
  # would silently replace this one instead of stacking, so any such
  # cleanup is folded in here rather than declared with its own trap.
  [[ -n "${TEMP_DIR:-}" ]] && rm -rf "$TEMP_DIR"
  if [[ $code -eq 0 ]]; then
    write_status "success" "Cập nhật hoàn tất."
  else
    write_status "failed" "${LAST_ERROR:-Update thất bại (exit $code). Xem log để chẩn đoán.}"
  fi
}
trap on_exit EXIT

die() {
  LAST_ERROR="$*"
  echo "Lỗi: $*" >&2
  exit 1
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else die "Thiếu sha256sum hoặc shasum."
  fi
}

download_verified() {
  local url="$1" destination="$2" expected actual
  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$destination"
  expected="$(curl --proto '=https' --tlsv1.2 -fsSL "$url.sha256" | awk 'NR == 1 {print $1}')"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die "Checksum bundle không hợp lệ."
  actual="$(sha256_file "$destination")"
  actual="$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')"
  expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
  [[ "$actual" == "$expected" ]] || die "SHA-256 bundle không khớp."
}

validate_archive() {
  local archive="$1" entry normalized
  while IFS= read -r entry; do
    normalized="${entry#./}"
    [[ "$normalized" != /* ]] || die "Archive chứa đường dẫn tuyệt đối: $entry"
    case "/$normalized/" in *"/../"*) die "Archive chứa đường dẫn thoát thư mục: $entry" ;; esac
  done < <(tar -tzf "$archive")
}

[[ -d "$INSTALL_DIR" ]] || die "Không tìm thấy thư mục cài đặt: $INSTALL_DIR (đặt CAMERAAIWORK_DIR nếu cài ở nơi khác)."
[[ -f "$INSTALL_DIR/apps/relay/package.json" ]] || die "$INSTALL_DIR không phải bản cài cameraaiwork hợp lệ."

# --post-restart is a self re-invocation (see the Linux restart branch below)
# that only needs to redo the restart + health-check tail of this script —
# the bundle was already fetched and installed by the invocation that handed
# off to this one.
if ! "$POST_RESTART"; then
  command -v curl >/dev/null 2>&1 || die "Thiếu curl."

  echo "==> Cập nhật cameraaiwork tại $INSTALL_DIR"

  echo "==> Gỡ lịch tự cập nhật legacy (nếu có)"
  case "$(uname -s)" in
    Darwin)
      LEGACY_PLIST="$HOME/Library/LaunchAgents/com.cameraaiwork.update.plist"
      launchctl bootout "gui/$(id -u)/com.cameraaiwork.update" >/dev/null 2>&1 || true
      if [[ -f "$LEGACY_PLIST" ]]; then mv "$LEGACY_PLIST" "$LEGACY_PLIST.disabled"; fi
      ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl disable --now cameraaiwork-update.timer >/dev/null 2>&1 || true
        for unit in cameraaiwork-update.timer cameraaiwork-update.service; do
          if [[ -f "/etc/systemd/system/$unit" ]]; then
            sudo mv "/etc/systemd/system/$unit" "/etc/systemd/system/$unit.disabled"
          fi
        done
        sudo systemctl daemon-reload
      fi
      ;;
  esac

  command -v tar >/dev/null 2>&1 || die "Thiếu tar."
  command -v rsync >/dev/null 2>&1 || die "Thiếu rsync."
  TEMP_DIR="$(mktemp -d)"
  echo "==> Tải gói cập nhật đã có checksum"
  download_verified "$BUNDLE_URL" "$TEMP_DIR/release.tar.gz"
  validate_archive "$TEMP_DIR/release.tar.gz"
  mkdir -p "$TEMP_DIR/release"
  tar -xzf "$TEMP_DIR/release.tar.gz" -C "$TEMP_DIR/release" --strip-components=1
  [[ -f "$TEMP_DIR/release/apps/relay/package.json" ]] || die "Gói cập nhật không hợp lệ."

  # No --delete: local camera/model files stay intact. Explicit exclusions are site state.
  rsync -a \
    --exclude='.git/' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='cameras.json' \
    --exclude='node_modules/' \
    --exclude='.venv/' \
    --exclude='infra/go2rtc/bin/' \
    --exclude='infra/go2rtc/go2rtc.yaml' \
    "$TEMP_DIR/release/" "$INSTALL_DIR/"

  echo "==> Tự động cập nhật bị tắt; chỉ chạy updater local sau khi quản trị viên kiểm tra release."

  echo "==> Cập nhật relay dependencies"
  command -v npm >/dev/null 2>&1 || die "Thiếu npm/Node.js."
  (cd "$INSTALL_DIR/apps/relay" && npm install --omit=dev --silent)

  # Keep talkback working on existing local PCs as go2rtc raises its minimum
  # supported FFmpeg version.
  bash "$INSTALL_DIR/apps/relay/ensure-ffmpeg.sh"

  echo "==> Cập nhật AI worker dependencies"
  PYTHON_BIN="${CAMERAAIWORK_PYTHON:-python3}"
  command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "Thiếu Python 3."
  if [[ ! -x "$INSTALL_DIR/ai/worker/.venv/bin/python" ]]; then
    "$PYTHON_BIN" -m venv "$INSTALL_DIR/ai/worker/.venv"
  fi
  "$INSTALL_DIR/ai/worker/.venv/bin/python" -m pip install -q -r "$INSTALL_DIR/ai/worker/requirements.txt"
fi

echo "==> Restart dịch vụ"
case "$(uname -s)" in
  Darwin)
    USER_ID="$(id -u)"
    for label in com.cameraaiwork.ai com.cameraaiwork.relay; do
      if launchctl print "gui/$USER_ID/$label" >/dev/null 2>&1; then
        launchctl kickstart -k "gui/$USER_ID/$label"
      else
        echo "Cảnh báo: chưa tìm thấy service $label; không restart service này." >&2
      fi
    done
    ;;
  Linux)
    command -v systemctl >/dev/null 2>&1 || die "Thiếu systemctl."
    if "$POST_RESTART"; then
      sudo systemctl restart cameraaiwork-ai cameraaiwork-relay
    elif command -v systemd-run >/dev/null 2>&1; then
      # Restarting cameraaiwork-relay tears down its whole cgroup, which
      # this script is currently a child of (it was spawned by the relay
      # process handling the dashboard's update request) — that would kill
      # this very script mid-restart, before it can run the health check
      # below or report a final status. Hand the restart + health check off
      # to an independent systemd-run scope that survives the teardown, and
      # let it report the real outcome; this invocation's job is done.
      echo "==> Bàn giao restart + kiểm tra dịch vụ cho tiến trình độc lập (tránh bị dừng khi service tự restart chính nó)"
      sudo systemd-run --collect --unit=cameraaiwork-update-finish -- bash "$0" --post-restart
      rm -rf "$TEMP_DIR"
      trap - EXIT
      exit 0
    else
      sudo systemctl restart cameraaiwork-ai cameraaiwork-relay
    fi
    ;;
  *) die "Hệ điều hành chưa được hỗ trợ bởi update.sh: $(uname -s)" ;;
esac

echo "==> Kiểm tra dịch vụ"
AI_OK=0
RELAY_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 2 http://127.0.0.1:8001/health >/dev/null 2>&1; then AI_OK=1; fi
  RELAY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:4000/health 2>/dev/null || true)"
  if [[ "$RELAY_STATUS" == "200" || "$RELAY_STATUS" == "401" || "$RELAY_STATUS" == "403" ]]; then RELAY_OK=1; fi
  if [[ "$AI_OK" == "1" && "$RELAY_OK" == "1" ]]; then break; fi
  sleep 1
done

[[ "$AI_OK" == "1" ]] || die "AI worker chưa healthy tại 127.0.0.1:8001. Xem log service để chẩn đoán."
[[ "$RELAY_OK" == "1" ]] || die "Relay chưa phản hồi tại 127.0.0.1:4000. Xem log service để chẩn đoán."

echo "Hoàn tất: relay/AI đã cập nhật và cấu hình được giữ nguyên."
