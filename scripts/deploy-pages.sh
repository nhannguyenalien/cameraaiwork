#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${CF_PAGES_PROJECT:-cameraaiwork}"
VARS_FILE="$ROOT_DIR/apps/pages/.dev.vars"

if [[ ! -f "$VARS_FILE" ]]; then
  echo "Thiếu $VARS_FILE" >&2
  exit 1
fi

echo "==> Kiểm tra code"
"$ROOT_DIR/scripts/test-all.sh"

echo "==> Xuất OpenAPI public cho agent"
cp "$ROOT_DIR/docs/openapi.yaml" "$ROOT_DIR/apps/pages/public/openapi.yaml"

echo "==> Migration Turso (có thể chạy lại an toàn)"
(cd "$ROOT_DIR/apps/pages" && node --env-file="$VARS_FILE" ../../scripts/migrate-db.mjs)

put_secret() {
  local name="$1" prompt="$2" optional="${3:-false}" value
  if [[ "$optional" == "true" ]]; then
    read -r -s -p "$prompt (Enter để bỏ qua): " value
  else
    read -r -s -p "$prompt: " value
  fi
  printf '\n'
  [[ -n "$value" ]] || { [[ "$optional" == "true" ]] && return 0; echo "$name là bắt buộc" >&2; exit 1; }
  (cd "$ROOT_DIR/apps/pages" && printf '%s' "$value" | npx wrangler pages secret put "$name" --project-name "$PROJECT_NAME")
  unset value
}

# Telegram and RunPod are customer BYOK integrations configured inside the
# dashboard. Only platform-wide secrets belong in this deploy script.
if ! (cd "$ROOT_DIR/apps/pages" && npx wrangler pages secret list --project-name "$PROJECT_NAME") | grep -q 'CUSTOMER_SECRETS_KEY'; then
  echo "==> Tạo khóa mã hóa credential khách hàng (chỉ tạo lần đầu)"
  customer_secrets_key="$(openssl rand -base64 32)"
  (cd "$ROOT_DIR/apps/pages" && printf '%s' "$customer_secrets_key" | npx wrangler pages secret put CUSTOMER_SECRETS_KEY --project-name "$PROJECT_NAME")
  unset customer_secrets_key
else
  echo "= CUSTOMER_SECRETS_KEY đã tồn tại, giữ nguyên để đọc được dữ liệu đã mã hóa"
fi

put_secret STRIPE_SECRET_KEY "Stripe secret key" true
put_secret STRIPE_WEBHOOK_SECRET "Stripe webhook signing secret" true
put_secret STRIPE_PRICE_ID "Stripe recurring Price ID" true

echo "==> Deploy Cloudflare Pages"
(cd "$ROOT_DIR/apps/pages" && npx wrangler pages deploy public --project-name "$PROJECT_NAME")

echo "Deploy Pages hoàn tất. Chạy ./scripts/e2e-check.sh để test một lần."
