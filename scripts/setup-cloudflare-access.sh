#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_ID="${CF_ACCOUNT_ID:-9894c19bea61205f902a5f7ab6cda468}"
HOSTNAME="${GO2RTC_HOST:-st-nhachinh01-go2rtc.schoolsai.work}"
ALLOW_EMAIL="${ACCESS_EMAIL:-nhantin3805@gmail.com}"
APP_NAME="cameraaiwork-${HOSTNAME}"
API="https://api.cloudflare.com/client/v4"

if [[ -z "${CF_ACCESS_TOKEN:-}" ]]; then
  read -r -s -p "Cloudflare Access API token: " CF_ACCESS_TOKEN
  printf '\n'
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

api_call() {
  local method="$1"
  local path="$2"
  local output="$3"
  local body="${4:-}"
  local args=(-sS -X "$method" "$API$path" -o "$output"
    -H "Authorization: Bearer $CF_ACCESS_TOKEN"
    -H "Content-Type: application/json")
  if [[ -n "$body" ]]; then
    args+=(-d "$body")
  fi
  curl "${args[@]}"
  python3 - "$output" "$method" "$path" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
if not data.get("success"):
    errors = data.get("errors") or [{"message": "Unknown Cloudflare API error"}]
    detail = "; ".join(
        f"{e.get('code', 'unknown')}: {e.get('message', e.get('error', e))}"
        for e in errors
    )
    raise SystemExit(f"Cloudflare API error at {sys.argv[2]} {sys.argv[3]}: {detail}")
PY
}

verify_file="$tmp_dir/verify.json"
api_call GET "/user/tokens/verify" "$verify_file"

apps_file="$tmp_dir/apps.json"
api_call GET "/accounts/$ACCOUNT_ID/access/apps" "$apps_file"
app_id="$(python3 - "$apps_file" "$HOSTNAME" <<'PY'
import json, sys
for app in json.load(open(sys.argv[1])).get("result", []):
    if app.get("domain") == sys.argv[2]:
        print(app["id"])
        break
PY
)"

if [[ -z "$app_id" ]]; then
  app_file="$tmp_dir/app.json"
  app_body="$(python3 - "$APP_NAME" "$HOSTNAME" <<'PY'
import json, sys
print(json.dumps({
    "name": sys.argv[1],
    "domain": sys.argv[2],
    "type": "self_hosted",
    "session_duration": "24h",
    "allow_iframe": True,
}))
PY
)"
  api_call POST "/accounts/$ACCOUNT_ID/access/apps" "$app_file" "$app_body"
  app_id="$(python3 - "$app_file" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))["result"]["id"])
PY
)"
  printf 'Created Access application for %s\n' "$HOSTNAME"
else
  printf 'Access application already exists for %s\n' "$HOSTNAME"
fi

policies_file="$tmp_dir/policies.json"
api_call GET "/accounts/$ACCOUNT_ID/access/apps/$app_id/policies" "$policies_file"
policy_exists="$(python3 - "$policies_file" "$ALLOW_EMAIL" <<'PY'
import json, sys
email = sys.argv[2].lower()
for policy in json.load(open(sys.argv[1])).get("result", []):
    for rule in policy.get("include", []):
        if rule.get("email", {}).get("email", "").lower() == email:
            print("yes")
            raise SystemExit
PY
)"

if [[ "$policy_exists" != "yes" ]]; then
  policy_file="$tmp_dir/policy.json"
  policy_body="$(python3 - "$ALLOW_EMAIL" <<'PY'
import json, sys
print(json.dumps({
    "name": "Allow camera owner",
    "decision": "allow",
    "precedence": 1,
    "include": [{"email": {"email": sys.argv[1]}}],
}))
PY
)"
  api_call POST "/accounts/$ACCOUNT_ID/access/apps/$app_id/policies" "$policy_file" "$policy_body"
  printf 'Created allow policy for %s\n' "$ALLOW_EMAIL"
else
  printf 'Allow policy already exists for %s\n' "$ALLOW_EMAIL"
fi

printf '\nTesting Access edge response...\n'
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$HOSTNAME/")"
location="$(curl -sS -o /dev/null -D - --max-time 20 "https://$HOSTNAME/" | awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/\r$/,""); print; exit}')"
printf 'HTTP %s\n' "$status"
[[ -n "$location" ]] && printf '%s\n' "$location"
