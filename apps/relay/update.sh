#!/usr/bin/env bash
set -euo pipefail

# Safe in-place updater for an already claimed cameraaiwork site.
# It never runs install/claim and never replaces .env or cameras.json.
#
# Remote usage:
#   curl -fsSL https://camera.schoolsai.work/update.sh | bash
# Custom install directory:
#   curl -fsSL https://camera.schoolsai.work/update.sh | env CAMERAAIWORK_DIR=/opt/cameraaiwork bash

API_BASE="${CAMERAAIWORK_API:-https://camera.schoolsai.work}"
BUNDLE_URL="${CAMERAAIWORK_BUNDLE_URL:-$API_BASE/cameraaiwork-relay.tar.gz}"
DEFAULT_INSTALL_DIR="${HOME}/cameraaiwork"

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

die() {
  echo "Lỗi: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || die "Thiếu curl."
[[ -d "$INSTALL_DIR" ]] || die "Không tìm thấy thư mục cài đặt: $INSTALL_DIR (đặt CAMERAAIWORK_DIR nếu cài ở nơi khác)."
[[ -f "$INSTALL_DIR/apps/relay/package.json" ]] || die "$INSTALL_DIR không phải bản cài cameraaiwork hợp lệ."

echo "==> Cập nhật cameraaiwork tại $INSTALL_DIR"

if [[ "${CAMERAAIWORK_UPDATE_SOURCE:-bundle}" == "git" && -d "$INSTALL_DIR/.git" ]] && command -v git >/dev/null 2>&1; then
  echo "==> Nhận mã nguồn mới bằng Git"
  git -C "$INSTALL_DIR" pull --ff-only || die "Git pull thất bại. Kiểm tra thay đổi local hoặc chạy updater bằng bundle."
else
  command -v tar >/dev/null 2>&1 || die "Thiếu tar."
  command -v rsync >/dev/null 2>&1 || die "Thiếu rsync."
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TEMP_DIR"' EXIT
  echo "==> Tải gói cập nhật"
  curl -fsSL "${BUNDLE_URL}?update=$(date +%s)" -o "$TEMP_DIR/release.tar.gz"
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
fi

echo "==> Bật tự động cập nhật"
case "$(uname -s)" in
  Darwin)
    mkdir -p "$HOME/Library/LaunchAgents"
    AUTO_PLIST="$HOME/Library/LaunchAgents/com.cameraaiwork.update.plist"
    sed -e "s|__UPDATE_SCRIPT__|$INSTALL_DIR/apps/relay/update.sh|g" \
        "$INSTALL_DIR/infra/launchd/com.cameraaiwork.update.plist" > "$AUTO_PLIST"
    launchctl bootout "gui/$(id -u)/com.cameraaiwork.update" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$AUTO_PLIST"
    ;;
  Linux)
    sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
        "$INSTALL_DIR/infra/systemd/cameraaiwork-update.service" | sudo tee /etc/systemd/system/cameraaiwork-update.service >/dev/null
    sudo cp "$INSTALL_DIR/infra/systemd/cameraaiwork-update.timer" /etc/systemd/system/cameraaiwork-update.timer
    sudo systemctl daemon-reload
    sudo systemctl enable --now cameraaiwork-update.timer >/dev/null
    ;;
esac

echo "==> Cập nhật relay dependencies"
command -v npm >/dev/null 2>&1 || die "Thiếu npm/Node.js."
(cd "$INSTALL_DIR/apps/relay" && npm install --omit=dev --silent)

echo "==> Cập nhật AI worker dependencies"
PYTHON_BIN="${CAMERAAIWORK_PYTHON:-python3}"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "Thiếu Python 3."
if [[ ! -x "$INSTALL_DIR/ai/worker/.venv/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$INSTALL_DIR/ai/worker/.venv"
fi
"$INSTALL_DIR/ai/worker/.venv/bin/python" -m pip install -q -r "$INSTALL_DIR/ai/worker/requirements.txt"

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
    sudo systemctl restart cameraaiwork-ai cameraaiwork-relay
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

echo "Hoàn tất: relay/AI đã cập nhật, cấu hình được giữ nguyên và lịch tự cập nhật đã bật."
