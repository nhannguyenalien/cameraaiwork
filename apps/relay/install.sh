#!/usr/bin/env bash
# One-command installer for a site's on-premise machine.
#
#   curl -fsSL https://raw.githubusercontent.com/nhannguyenalien/cameraaiwork/main/apps/relay/install.sh | bash
#
# Does everything Phase 1 of docs/PLAN.md used to require by hand: clones
# the repo, installs cloudflared + go2rtc, asks for the account API key and
# camera info, registers the site/camera with the backend (POST /api/sites,
# POST /api/sites/:id/cameras — no manual Turso access needed), writes
# local config, and installs the always-on service. The relay itself starts
# its own Cloudflare Quick Tunnels and self-registers their URLs — nothing
# to configure on Cloudflare's side either.
set -euo pipefail

REPO_URL="${CAMERAAIWORK_REPO:-https://github.com/nhannguyenalien/cameraaiwork.git}"
INSTALL_DIR="${CAMERAAIWORK_DIR:-$HOME/cameraaiwork}"
API_BASE="${CAMERAAIWORK_API:-https://cameraaiwork.pages.dev}"

echo "=== cameraaiwork — cài đặt on-site ==="
echo "Sẽ cài vào: $INSTALL_DIR"
echo "Backend: $API_BASE"
echo

# --- 1. Prerequisites ---
if ! command -v node >/dev/null 2>&1; then
  echo "!! Cần cài Node.js trước (https://nodejs.org), rồi chạy lại script này." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "!! Cần cài git trước." >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "==> Cài cloudflared..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      brew install cloudflared
    else
      echo "!! Cần Homebrew để tự cài cloudflared trên macOS, hoặc cài thủ công: https://github.com/cloudflare/cloudflared/releases" >&2
      exit 1
    fi
  else
    arch="$(uname -m)"
    case "$arch" in
      x86_64) cf_asset="cloudflared-linux-amd64" ;;
      aarch64) cf_asset="cloudflared-linux-arm64" ;;
      *) echo "!! Kiến trúc $arch chưa hỗ trợ tự cài cloudflared, cài thủ công: https://github.com/cloudflare/cloudflared/releases" >&2; exit 1 ;;
    esac
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/$cf_asset" -o /tmp/cloudflared
    chmod +x /tmp/cloudflared
    sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
  fi
fi

# --- 2. Get the code ---
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "==> Cập nhật $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "==> Tải cameraaiwork về $INSTALL_DIR..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# --- 3. Ask for account + camera info ---
echo
read -rp "Dán API key account của bạn: " API_KEY
read -rp "Tên địa điểm (vd: Nhà chính): " SITE_NAME
read -rp "IP camera trong LAN: " CAM_IP
read -rp "Username ONVIF: " CAM_USER
read -rsp "Password ONVIF: " CAM_PASS
echo
read -rp "Cổng ONVIF [2020]: " CAM_ONVIF_PORT
CAM_ONVIF_PORT="${CAM_ONVIF_PORT:-2020}"

# --- 4. Register the site + camera with the backend ---
echo
echo "==> Đăng ký site với backend..."
SITE_RESP=$(curl -fsS -X POST "$API_BASE/api/sites" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"name\":\"$SITE_NAME\"}")
SITE_ID=$(echo "$SITE_RESP" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).siteId')
RELAY_SECRET=$(echo "$SITE_RESP" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).relaySecret')
echo "    siteId = $SITE_ID"

echo "==> Đăng ký camera..."
curl -fsS -X POST "$API_BASE/api/sites/$SITE_ID/cameras" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"stream\":\"cam1\",\"name\":\"$SITE_NAME\"}" > /dev/null
echo "    camera 'cam1' đã đăng ký"

# --- 5. Write local config (never committed — see .gitignore) ---
cat > apps/relay/cameras.json <<EOF
[
  {
    "id": "cam1",
    "stream": "cam1",
    "onvif": {
      "ip": "$CAM_IP",
      "port": $CAM_ONVIF_PORT,
      "username": "$CAM_USER",
      "password": "$CAM_PASS"
    }
  }
]
EOF

cat > apps/relay/.env <<EOF
SITE_ID=$SITE_ID
RELAY_PORT=4000
RELAY_SECRET=$RELAY_SECRET
GO2RTC_URL=http://localhost:1984
PAGES_API_URL=$API_BASE
EOF

echo "==> Đã ghi apps/relay/cameras.json và apps/relay/.env"

# --- 6. go2rtc + relay deps ---
bash infra/setup.sh
(cd apps/relay && npm install --silent)

# --- 7. Install as an always-on service ---
NODE_PATH="$(command -v node)"
USER_NAME="$(whoami)"

if [[ "$(uname -s)" == "Darwin" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"

  for svc in go2rtc relay; do
    src="infra/launchd/com.cameraaiwork.$svc.plist"
    dest="$HOME/Library/LaunchAgents/com.cameraaiwork.$svc.plist"
    sed -e "s#REPLACE_WITH_REPO_ROOT#$INSTALL_DIR#g" \
        -e "s#REPLACE_WITH_NODE_PATH#$NODE_PATH#g" \
        "$src" > "$dest"
    launchctl unload "$dest" 2>/dev/null || true
    launchctl load "$dest"
  done
  echo "==> Đã cài 2 launchd service (go2rtc, relay). Logs: /tmp/cameraaiwork-*.log"
else
  for svc in go2rtc relay; do
    src="infra/systemd/cameraaiwork-$svc.service"
    dest="/etc/systemd/system/cameraaiwork-$svc.service"
    sed -e "s#REPLACE_WITH_REPO_ROOT#$INSTALL_DIR#g" \
        -e "s#REPLACE_WITH_USER#$USER_NAME#g" \
        "$src" | sudo tee "$dest" > /dev/null
  done
  sudo systemctl daemon-reload
  sudo systemctl enable --now cameraaiwork-go2rtc cameraaiwork-relay
  echo "==> Đã cài 2 systemd service (go2rtc, relay)."
fi

echo
echo "✅ Xong! Mở $API_BASE, đăng nhập bằng API key vừa dùng ở trên."
echo "   Camera + live view sẽ xuất hiện trong vòng ~10-15 giây (chờ tunnel lên)."
