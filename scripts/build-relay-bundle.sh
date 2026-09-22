#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/apps/pages/public"
BUNDLE="$PUBLIC_DIR/cameraaiwork-relay.tar.gz"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

repo_name="$(basename "$ROOT_DIR")"
archive="$STAGING/cameraaiwork-relay.tar.gz"

# Computed before writing VERSION.json below, so that file's own churn never
# makes an otherwise-clean tree look dirty.
commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
commit_date="$(git -C "$ROOT_DIR" log -1 --format=%cI 2>/dev/null || echo unknown)"
if git -C "$ROOT_DIR" diff --quiet 2>/dev/null && git -C "$ROOT_DIR" diff --cached --quiet 2>/dev/null; then
  dirty=false
else
  dirty=true
fi
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Bundled into apps/relay so the relay running at a site can report which
# release it's on (apps/relay/src/index.js reads this for /update/status);
# mirrored to the public dir below so the dashboard knows the latest
# available release without asking any site's relay.
version_json="$(printf '{"commit":"%s","commitDate":"%s","builtAt":"%s","dirty":%s}' \
  "$commit" "$commit_date" "$built_at" "$dirty")"
printf '%s\n' "$version_json" > "$ROOT_DIR/apps/relay/VERSION.json"

COPYFILE_DISABLE=1 tar -czf "$archive" \
  --no-xattrs --no-acls --no-fflags \
  --exclude='._*' \
  --exclude='*/._*' \
  --exclude='.env' \
  --exclude='.dev.vars' \
  --exclude='cameras.json' \
  --exclude='node_modules' \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='.DS_Store' \
  --exclude='*/.DS_Store' \
  --exclude='*/ai/worker/models' \
  --exclude='*/infra/go2rtc/bin' \
  --exclude='*/infra/go2rtc/go2rtc.yaml' \
  -C "$(dirname "$ROOT_DIR")" \
  "$repo_name/apps/relay" "$repo_name/ai/worker" "$repo_name/infra"

mv "$archive" "$BUNDLE"
shasum -a 256 "$BUNDLE" | awk '{print $1}' > "$BUNDLE.sha256"
printf '%s\n' "$version_json" > "$PUBLIC_DIR/cameraaiwork-relay-version.json"

while IFS= read -r model; do
  shasum -a 256 "$model" | awk '{print $1}' > "$model.sha256"
done < <(find "$PUBLIC_DIR/models" -type f ! -name '*.sha256' -print)

echo "Đã tạo bundle tối giản và checksum: $BUNDLE"
