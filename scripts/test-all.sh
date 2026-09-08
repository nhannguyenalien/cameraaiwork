#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> OpenAPI contract"
test -s "$ROOT_DIR/docs/openapi.yaml"
if [[ -f "$ROOT_DIR/apps/pages/public/openapi.yaml" ]]; then
  cmp "$ROOT_DIR/docs/openapi.yaml" "$ROOT_DIR/apps/pages/public/openapi.yaml"
fi

echo "==> Cloudflare Pages Functions build"
(cd "$ROOT_DIR/apps/pages" && npx wrangler pages functions build)

echo "==> Dashboard integration security tests"
(cd "$ROOT_DIR/apps/pages" && node --test test/*.test.mjs)

echo "==> Relay signed-stream security tests"
(cd "$ROOT_DIR/apps/relay" && npm test)

echo "==> RunPod worker unit tests"
(cd "$ROOT_DIR/runpod/heavy-worker" && RUNPOD_SERVERLESS=0 python3 -m unittest -v test_handler.py)

echo "==> Python syntax"
python3 -m py_compile "$ROOT_DIR/ai/worker/main.py" "$ROOT_DIR/runpod/heavy-worker/handler.py"

echo "==> Shell and relay JavaScript syntax"
bash -n "$ROOT_DIR"/scripts/*.sh "$ROOT_DIR/apps/relay/install.sh" "$ROOT_DIR/apps/relay/update.sh" "$ROOT_DIR/apps/pages/public/update.sh"
node --check "$ROOT_DIR/apps/relay/src/index.js"
node --check "$ROOT_DIR/apps/relay/src/live-auth.js"
node --check "$ROOT_DIR/apps/relay/src/ptz.js"

echo "All automated checks passed."
