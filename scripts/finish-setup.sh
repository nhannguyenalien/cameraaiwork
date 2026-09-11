#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Secrets nền tảng, migration và Pages deploy"
"$ROOT_DIR/scripts/deploy-pages.sh"

read -r -s -p "API key tài khoản owner để upgrade tunnel + E2E: " DASHBOARD_API_KEY
printf '\n'
export DASHBOARD_API_KEY
UPGRADE_SITE_ID="${UPGRADE_SITE_ID:-st-nhachinh01}" "$ROOT_DIR/scripts/e2e-check.sh"

unset DASHBOARD_API_KEY
echo "Hoàn tất setup cloud + E2E. Bước cuối trên máy camera: tải, kiểm tra rồi chạy installer từ dashboard."
