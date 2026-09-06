#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_ID="${CF_ACCOUNT_ID:-9894c19bea61205f902a5f7ab6cda468}"
HOSTNAMES="${ACCESS_HOSTNAMES:-st-nhachinh01-go2rtc.schoolsai.work,st-nhachinh01-ai.schoolsai.work}"
PROJECT_NAME="${CF_PAGES_PROJECT:-cameraaiwork}"
TOKEN_NAME="${ACCESS_SERVICE_TOKEN_NAME:-cameraaiwork-pages-go2rtc}"
API="https://api.cloudflare.com/client/v4"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${CF_ACCESS_TOKEN:-}" ]]; then
  read -r -s -p "Cloudflare API token (Apps/Policies + Service Tokens Write): " CF_ACCESS_TOKEN
  printf '\n'
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

api_call() {
  local method="$1" path="$2" output="$3" body="${4:-}"
  local args=(-sS -X "$method" "$API$path" -o "$output"
    -H "Authorization: Bearer $CF_ACCESS_TOKEN"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
  python3 - "$output" "$method" "$path" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
if not data.get("success"):
    errors = data.get("errors") or [{"message": "Unknown Cloudflare API error"}]
    detail = "; ".join(f"{e.get('code', 'unknown')}: {e.get('message', e.get('error', e))}" for e in errors)
    raise SystemExit(f"Cloudflare API error at {sys.argv[2]} {sys.argv[3]}: {detail}")
PY
}

apps_file="$tmp_dir/apps.json"
api_call GET "/accounts/$ACCOUNT_ID/access/apps" "$apps_file"

tokens_file="$tmp_dir/tokens.json"
api_call GET "/accounts/$ACCOUNT_ID/access/service_tokens" "$tokens_file"
existing_id="$(python3 - "$tokens_file" "$TOKEN_NAME" <<'PY'
import json, sys
for token in json.load(open(sys.argv[1])).get("result", []):
    if token.get("name") == sys.argv[2]:
        print(token["id"])
        break
PY
)"
if [[ -n "$existing_id" ]]; then
  echo "Service token '$TOKEN_NAME' đã tồn tại; không thể đọc lại client secret." >&2
  echo "Hãy xóa token đó trong Zero Trust > Access > Service credentials rồi chạy lại." >&2
  exit 1
fi

token_file="$tmp_dir/token.json"
api_call POST "/accounts/$ACCOUNT_ID/access/service_tokens" "$token_file" \
  "$(python3 - "$TOKEN_NAME" <<'PY'
import json, sys
print(json.dumps({"name": sys.argv[1], "duration": "8760h"}))
PY
)"

read -r service_token_id client_id client_secret < <(python3 - "$token_file" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))["result"]
print(r["id"], r["client_id"], r["client_secret"])
PY
)

IFS=',' read -r -a access_hosts <<< "$HOSTNAMES"
for hostname in "${access_hosts[@]}"; do
  hostname="${hostname## }"
  hostname="${hostname%% }"
  app_id="$(python3 - "$apps_file" "$hostname" <<'PY'
import json, sys
for app in json.load(open(sys.argv[1])).get("result", []):
    if app.get("domain") == sys.argv[2]:
        print(app["id"])
        break
PY
)"
  [[ -n "$app_id" ]] || { echo "Không tìm thấy Access application cho $hostname" >&2; exit 1; }

  policy_file="$tmp_dir/policy-${app_id}.json"
  api_call POST "/accounts/$ACCOUNT_ID/access/apps/$app_id/policies" "$policy_file" \
    "$(python3 - "$service_token_id" <<'PY'
import json, sys
print(json.dumps({
    "name": "Allow cameraaiwork Pages service",
    "decision": "non_identity",
    "precedence": 2,
    "include": [{"service_token": {"token_id": sys.argv[1]}}],
}))
PY
)"
  echo "Đã cấp service token cho $hostname"
done

cd "$REPO_ROOT/apps/pages"
printf '%s' "$client_id" | npx wrangler pages secret put ACCESS_CLIENT_ID --project-name "$PROJECT_NAME"
printf '%s' "$client_secret" | npx wrangler pages secret put ACCESS_CLIENT_SECRET --project-name "$PROJECT_NAME"

echo "Đã tạo service token, policies và lưu Pages secrets."
