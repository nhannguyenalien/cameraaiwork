# cameraaiwork

Multi-site, multi-tenant camera platform: live view (go2rtc), PTZ control,
motion-triggered alerts with AI person detection, and an API-first design
so a dashboard, an AI agent, or a customer's own app can all drive it the
same way.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and
[docs/API.md](docs/API.md) for the API contract.

## Layout

```
apps/relay/           Node — runs ON-SITE, next to the cameras. ONVIF PTZ
                       + motion webhook forwarding ONLY. No UI/DB/Telegram.
apps/pages/            Cloudflare Pages: static Tabler dashboard + Functions
                       (the entire API — auth, DB, AI orchestration, jobs).
ai/worker/             Python: local lightweight "is there a person" service,
                       runs on-site, called by apps/pages/functions/api/motion.js.
runpod/heavy-worker/   Python: RunPod Serverless handler for heavy GPU tasks.
infra/                 go2rtc config/setup, launchd (macOS) + systemd (Linux)
                       service files.
apps/relay/win/        Windows Service wrappers (node-windows), used by install.ps1.
docs/                  architecture + API docs.
```

## Bootstrap

### Backend (once)

1. **Turso**: create a DB, run `apps/pages/schema.sql` against it.
2. Insert one row into `accounts`, then generate its API key:
   ```bash
   cd apps/pages && node scripts/generate-api-key.js acct_owner
   ```
3. **Cloudflare Pages**: connect this repo via the dashboard (build output
   directory: `apps/pages/public`), env vars from `.dev.vars.example`. Or
   run locally for testing: `cp .dev.vars.example .dev.vars`, `npm install && npm run dev`.

### On-site machine (per site — this is the part meant to be handed to a
### customer, not something you do for them)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/nhannguyenalien/cameraaiwork/main/apps/relay/install.sh | bash
```

**Windows** (PowerShell, as Administrator — required to install a service):
```powershell
irm https://raw.githubusercontent.com/nhannguyenalien/cameraaiwork/main/apps/relay/install.ps1 | iex
```

Both prompt for the account API key (from step 2) and the camera's ONVIF
ip/user/password, then do everything else on their own: clone the repo,
install `cloudflared` + go2rtc, register the site + camera with the
backend (`POST /api/sites`, no manual Turso access — this also
provisions a real Cloudflare Tunnel server-side, on our own domain, with
a stable hostname; falls back to an ephemeral Quick Tunnel only if the
backend has no `CLOUDFLARE_API_TOKEN` configured), and install
themselves as an always-on service (launchd on macOS, systemd on Linux,
a Windows Service via `node-windows` on Windows). No Cloudflare dashboard,
no hand-edited config files, no manual DB inserts, on any platform — the
customer needs neither their own Cloudflare account nor their own domain.

Open the dashboard, paste the same API key — the camera shows up on its
own within ~15 seconds.

> macOS has been run end to end against a real camera and a real Turso DB.
> Linux and Windows follow the identical flow and every third-party asset
> name involved (go2rtc/cloudflared release filenames) has been verified
> to exist, but neither has been run start-to-finish on real hardware yet
> — see `docs/PLAN.md`.

## Adding a second site or a second customer

A second site: run the installer again there, with the same account API
key. A second customer: insert one row into `accounts`, generate their own
API key, hand them the same one-line install command with their key.

## Adding AI

- **Person detection on the live alert path**: implement `detect_person()`
  in `ai/worker/main.py` (currently a stub returning `False`), deploy it
  on-site, set `AI_WORKER_URL` in the Pages env vars.
- **Heavier GPU tasks**: implement a `task` branch in
  `runpod/heavy-worker/handler.py`, deploy as a RunPod Serverless endpoint,
  dispatch via `POST /api/jobs`.

## Notes

- This repo intentionally excludes an unrelated invoice/debt-tracking app
  (`test/`, `claude.html`) and a superseded Python/Flask PTZ experiment
  (`pythonc/`) that were sitting in the original working folder.
- The original folder had a GitHub personal access token committed in
  plaintext (unrelated `test/` project, repo `hdtam`). If it hasn't been
  revoked yet: GitHub → Settings → Developer settings → Personal access
  tokens.
- Signup/login UI, billing, and plan limits aren't built — the schema and
  API are ready for them, but which auth/billing provider to use is a
  product decision, not assumed here. See "Multi-tenant / SaaS readiness"
  in `docs/ARCHITECTURE.md`.
