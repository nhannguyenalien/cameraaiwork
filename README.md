# cameraaiwork

Web dashboard for a Tapo C200 camera: live view (via go2rtc), PTZ control,
motion-triggered Telegram alerts, and a path to AI person detection —
cheap/local for the live alert path, RunPod GPU for occasional heavy tasks.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and
the reasoning behind it.

## Layout

```
apps/web/            Node/Express backend + dashboard (main orchestration layer)
ai/worker/            Python: local lightweight "is there a person" service
runpod/heavy-worker/  Python: RunPod Serverless handler for heavy GPU tasks
infra/                go2rtc config/setup, launchd services, Caddy reverse proxy
data/                 sqlite db + clips (gitignored, not committed)
docs/                 architecture notes
```

## Quick start (local dev)

```bash
cp .env.example .env        # fill in camera credentials, etc.
bash infra/setup.sh         # downloads go2rtc + renders infra/go2rtc/go2rtc.yaml
infra/go2rtc/bin/go2rtc -config infra/go2rtc/go2rtc.yaml &

cd apps/web && npm install && npm run dev
```

Open http://localhost:3021.

## Deploying to the VPS Mac mini

1. Run the camera-facing pieces (`go2rtc`) wherever the camera is actually
   reachable on the LAN — that may or may not be the same machine as the
   VPS. Connect the two over Cloudflare Tunnel or Tailscale (no port
   forwarding). Details in `docs/ARCHITECTURE.md`.
2. Install `infra/launchd/*.plist` (macOS) so `go2rtc` and `apps/web`
   survive reboots/crashes — edit the placeholder paths first.
3. Put Caddy (`infra/caddy/Caddyfile`) in front of the web app for HTTPS.
4. Gate the public hostname with Cloudflare Access before going live.

## Adding AI

- **Person detection on the live alert path**: implement `detect_person()`
  in `ai/worker/main.py` (currently a stub returning `False`), then set
  `AI_WORKER_URL` in `.env`. See `ai/worker/README.md`.
- **Heavier GPU tasks** (face search, highlight reels, etc.): implement a
  `task` branch in `runpod/heavy-worker/handler.py`, deploy it as a RunPod
  Serverless endpoint, call it via `apps/web/src/services/runpod.js`. See
  `runpod/heavy-worker/README.md`.

## Notes

- This repo intentionally excludes an unrelated invoice/debt-tracking app
  (`test/`, `claude.html`) and a superseded Python/Flask PTZ experiment
  (`pythonc/`) that were sitting in the original working folder.
- The original folder also had a GitHub personal access token committed in
  plaintext in a `package.json` (unrelated `test/` project, repo `hdtam`).
  If that token hasn't been revoked yet, do that in GitHub → Settings →
  Developer settings → Personal access tokens.
