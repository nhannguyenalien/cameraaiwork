#!/usr/bin/env bash
set -euo pipefail

API_BASE="${CAMERAAIWORK_API:-https://cameraaiwork.pages.dev}"
API_KEY="${DASHBOARD_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  read -r -s -p "API key dashboard: " API_KEY
  printf '\n'
fi

check_status() {
  local expected="$1" url="$2" actual
  actual="$(curl -sS -o /dev/null -w '%{http_code}' "$url")"
  [[ "$actual" == "$expected" ]] || { echo "FAIL $url: HTTP $actual, cần $expected" >&2; return 1; }
  echo "OK   $url -> HTTP $actual"
}

echo "==> Public/API"
check_status 200 "$API_BASE/api/health"
curl -fsS "$API_BASE/api/sites" -H "Authorization: Bearer $API_KEY" >/dev/null
echo "OK   dashboard API authenticated"

if [[ -n "${UPGRADE_SITE_ID:-}" ]]; then
  curl -fsS -X POST "$API_BASE/api/sites/$UPGRADE_SITE_ID/tunnel/upgrade" \
    -H "Authorization: Bearer $API_KEY" >/dev/null
  echo "OK   tunnel $UPGRADE_SITE_ID đã gom về một hostname"
fi

echo "==> Signed WebRTC URL + internal origin isolation"
CAMERAS="$(curl -fsS "$API_BASE/api/cameras" -H "Authorization: Bearer $API_KEY")"
SITE_ID="$(printf '%s' "$CAMERAS" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0]?.siteId || ""')"
CAMERA_ID="$(printf '%s' "$CAMERAS" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0]?.cameraId || ""')"
[[ -n "$SITE_ID" && -n "$CAMERA_ID" ]] || { echo "FAIL account chưa có camera để test live" >&2; exit 1; }

LIVE_JSON="$(curl -fsS -X POST "$API_BASE/api/cameras/$SITE_ID/$CAMERA_ID/live" -H "Authorization: Bearer $API_KEY")"
LIVE_URL="$(printf '%s' "$LIVE_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).url')"
VIEWER_LIMIT="$(printf '%s' "$LIVE_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).viewerLimit')"
SITE_ORIGIN="$(printf '%s' "$LIVE_URL" | node -pe 'new URL(require("fs").readFileSync(0,"utf8")).origin')"
[[ "$VIEWER_LIMIT" =~ ^[1-9][0-9]*$ ]] || { echo "FAIL live response thiếu viewerLimit hợp lệ" >&2; exit 1; }
[[ "$LIVE_URL" == *"/live/v2."* ]] || { echo "FAIL live URL chưa dùng token v2" >&2; exit 1; }
check_status 401 "$SITE_ORIGIN/internal/go2rtc/api"
check_status 401 "$SITE_ORIGIN/internal/ai/health"
check_status 401 "$SITE_ORIGIN/live/invalid/stream.html?src=$CAMERA_ID&mode=webrtc"
check_status 200 "$LIVE_URL"
echo "OK   signed live token v2, viewerLimit=$VIEWER_LIMIT"

echo "E2E cơ bản hoàn tất. Kiểm tra live view và tạo một motion event trên dashboard để xác nhận clip + Telegram."
