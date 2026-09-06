# cameraaiwork

Multi-site, multi-tenant camera platform: live view (go2rtc), PTZ control,
motion-triggered alerts with AI person detection, and an API-first design
so a dashboard, an AI agent, or a customer's own app can all drive it the
same way.

Start at [docs/README.md](docs/README.md). The machine-readable API contract is
[docs/openapi.yaml](docs/openapi.yaml) and is also published as `/openapi.yaml`.

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
2. Run the DB migration; customers then create their own account from the dashboard.
3. **Cloudflare Pages**: connect this repo via the dashboard (build output
   directory: `apps/pages/public`), env vars from `.dev.vars.example`. Or
   run locally for testing: `cp .dev.vars.example .dev.vars`, `npm install && npm run dev`.

### On-site machine (per site — this is the part meant to be handed to a
### customer, not something you do for them)

The repository can stay private: the dashboard hosts a secret-free relay bundle
for first install. A read-only GitHub deploy key is optional for `git pull` updates. Full prerequisites and
verification commands are in [docs/INSTALL-SITE.md](docs/INSTALL-SITE.md).

**macOS / Linux:** đăng nhập dashboard, mở **Cấu hình → Cài relay lên VPS** và chạy lệnh được sinh tại đó. Lệnh dùng token một lần gắn với account hiện tại, không dùng API key dài hạn.
```bash
curl -fsSL https://camera.schoolsai.work/install.sh | sudo env CAMERAAIWORK_INSTALL_TOKEN='...' CAMERAAIWORK_API='https://camera.schoolsai.work' bash
```

**Windows** (PowerShell, as Administrator — required to install a service):
```powershell
git clone --depth 1 git@github.com:nhannguyenalien/cameraaiwork.git
cd cameraaiwork
$env:CAMERAAIWORK_REPO='git@github.com:nhannguyenalien/cameraaiwork.git'
.\apps\relay\install.ps1
```

The Linux/macOS installer consumes the dashboard's one-time account-bound token and prompts for the camera's RTSP/ONVIF
ip/user/password, then do everything else on their own: clone the repo,
install `cloudflared` + go2rtc, register the site + camera with the
backend (`POST /api/sites`, no manual Turso access — this also
provisions a real Cloudflare Tunnel server-side, on our own domain, with
a stable hostname), and install
themselves as an always-on service (launchd on macOS, systemd on Linux,
a Windows Service via `node-windows` on Windows). No Cloudflare dashboard,
no hand-edited config files, no manual DB inserts, on any platform — the
customer needs neither their own Cloudflare account nor their own domain.
Each site gets exactly one Named Tunnel and one hostname. The customer
authenticates only with the SaaS; live view uses a short-lived signed URL,
not Cloudflare Access. go2rtc listens on localhost and is reachable only
through the validating relay.

Free accounts allow one concurrent live viewer per camera; Pro allows five.
An hourly maintenance workflow removes product-owned orphan tunnels after a
six-hour grace period and alerts by failing when configured Tunnel/DNS safety
thresholds are reached. Configure `MAINTENANCE_SECRET` in Pages and add GitHub
Actions secrets `DASHBOARD_URL` and `MAINTENANCE_SECRET`.

Open the dashboard and sign in — the camera shows up on its
own within ~15 seconds.

> macOS has been run end to end against a real camera and a real Turso DB.
> Linux and Windows follow the identical flow and every third-party asset
> name involved (go2rtc/cloudflared release filenames) has been verified
> to exist, but neither has been run start-to-finish on real hardware yet
> — see `docs/PLAN.md`.

## Adding a second site or a second customer

A second site: generate a new one-time install command while logged into the
same customer's dashboard. A second customer signs up independently and
generates a command from their own dashboard.

## Adding AI

- **Person detection on the live alert path**: deploy the implemented ONNX
  worker on-site; the relay exposes it only on the authenticated
  `/internal/ai` path of the site's single hostname.
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
- Signup/login, Stripe billing hooks, enforced plan limits and encrypted
  customer integrations are implemented. Stripe remains platform-owned;
  Telegram and RunPod are customer BYOK settings in the dashboard.
