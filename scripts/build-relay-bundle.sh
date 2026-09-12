#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/apps/pages/public"
BUNDLE="$PUBLIC_DIR/cameraaiwork-relay.tar.gz"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

repo_name="$(basename "$ROOT_DIR")"
archive="$STAGING/cameraaiwork-relay.tar.gz"

COPYFILE_DISABLE=1 tar -czf "$archive" \
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

while IFS= read -r model; do
  shasum -a 256 "$model" | awk '{print $1}' > "$model.sha256"
done < <(find "$PUBLIC_DIR/models" -type f ! -name '*.sha256' -print)

echo "Đã tạo bundle tối giản và checksum: $BUNDLE"
