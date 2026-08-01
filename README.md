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
docs/                  architecture + API docs.
```

## Bootstrap (one account, one site, one camera)

1. **Turso**: create a DB, run `apps/pages/schema.sql` against it.
2. Seed one account/site/camera (see the commented example at the bottom of
   `schema.sql`), then generate its API key:
   ```bash
   cd apps/pages && node scripts/generate-api-key.js acct_owner
   ```
3. **On-site machine** (next to the camera):
   ```bash
   cd apps/relay
   cp cameras.json.example cameras.json   # fill in ONVIF ip/user/pass
   cp .env.example .env                   # SITE_ID must match the sites.id you inserted
   npm install
   bash ../../infra/setup.sh              # downloads go2rtc, renders go2rtc.yaml from cameras.json
   infra/go2rtc/bin/go2rtc -config infra/go2rtc/go2rtc.yaml &
   npm start
   ```
   Then install `infra/launchd/*.plist` (macOS) or `infra/systemd/*.service`
   (Linux) so both survive reboots, and put `go2rtc` + the relay behind a
   Cloudflare Tunnel so Cloudflare Pages can reach them.
4. **Cloudflare Pages**: connect this repo via the dashboard (build output
   directory: `apps/pages/public`), or run locally:
   ```bash
   cd apps/pages
   cp .dev.vars.example .dev.vars   # fill in TURSO_*, TELEGRAM_*, etc.
   npm install
   npm run dev
   ```
5. Open the dashboard, paste the API key from step 2.

## Adding a second site or a second customer

No code changes — insert rows. A new site: one row in `sites`, one row per
camera in `cameras`, run `apps/relay` there pointed at the new `SITE_ID`. A
new customer: one row in `accounts`, a new API key, then their own
sites/cameras rows.

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
