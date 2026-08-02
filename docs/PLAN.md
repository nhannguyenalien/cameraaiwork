# Plan

Working checklist for taking this from "code exists" to "running system".
Check items off as they're done. Each phase has a clear definition of done
so it's obvious when to move to the next one.

Status as of this writing: **Turso DB is live and seeded, the API is
verified working end to end against it locally, and go2rtc/relay run
correctly on the on-site Mac. Blocked on: the physical camera being
powered on, and standing up the Cloudflare Tunnel + Pages deployment.**

---

## Phase 0 — what already exists (recap, no action needed)

- [x] `apps/relay` — ONVIF PTZ + motion webhook forwarder, multi-camera per site
- [x] `apps/pages` — Cloudflare Pages Functions API (cameras/events/jobs/motion/health) + Tabler dashboard, multi-tenant, backed by Turso
- [x] `ai/worker` — FastAPI stub, `detect_person()` not implemented yet
- [x] `runpod/heavy-worker` — RunPod handler stub, no task implemented yet
- [x] `schema.sql`, `docs/ARCHITECTURE.md`, `docs/API.md`, `README.md`
- [x] `infra/` — setup.sh, launchd (macOS) + systemd (Linux) service templates
- [x] Pushed to `github.com/nhannguyenalien/cameraaiwork`

Known debt carried in from the original code, not yet fixed:
- [ ] Revoke the leaked GitHub PAT found in the original `test/` folder (unrelated `hdtam` project) if not already done — `***REMOVED-GITHUB-PAT***`
- [ ] Motion detection in `apps/relay` matches raw substrings in the SSE payload (`data.includes('motion')`) instead of parsing JSON — fine for now, revisit if false positives show up

---

## Phase 1 — get one camera working end to end

Goal: open the dashboard, see the live stream, move the camera, see a
motion event show up. This is the phase that proves the architecture
actually works, before investing in anything else.

- [x] Create a Turso DB, run `apps/pages/schema.sql` against it — DB `camera` (`libsql://camera-toidayhoc.aws-ap-northeast-1.turso.io`), all 6 tables created
- [x] Seed one row each in `accounts`, `sites`, `cameras` — `acct_owner`, `acct_owner:nha_chinh`, `acct_owner:nha_chinh:tapo`
- [x] `node apps/pages/scripts/generate-api-key.js acct_owner` → inserted, raw key saved by the user (not in this repo/plan)
- [x] Fixed a bug in `infra/setup.sh`: macOS/Windows go2rtc releases are
      `.zip`, Linux is a raw binary — script only handled the Linux case
- [ ] On the machine next to the camera (this Mac, confirmed same LAN as
      the camera — `192.168.2.25` vs camera `192.168.2.23`):
  - [x] `apps/relay/cameras.json` filled in with real ONVIF creds (from
        the original `go2rtc.yaml`/`server.js`: `toidayhoc`/`toidayhoc`, port 2020)
  - [x] `apps/relay/.env` set, `SITE_ID=acct_owner:nha_chinh`, generated `RELAY_SECRET` (matches the `sites` row)
  - [x] `bash infra/setup.sh` ran clean after the zip fix
  - [x] go2rtc starts, config loads correctly (`/api/streams` shows the `tapo` producers)
  - [x] `apps/relay` starts, ONVIF connect attempt fails cleanly with
        `EHOSTDOWN` and retries every 5s as designed — **the camera itself is
        currently powered off/disconnected**, this isn't a code problem
  - [ ] **Blocked: power the camera back on**, then re-verify ONVIF actually
        connects (log line "✅ ONVIF PTZ sẵn sàng") and the RTSP stream is live
- [ ] Install `cloudflared`, create a tunnel exposing go2rtc (port 1984) and the relay (port 4000) as two public hostnames
- [ ] Update the `sites` row (currently `go2rtc_url`/`relay_url` = `PENDING_TUNNEL_URL` placeholders) with the real tunnel hostnames
- [x] Deployed `apps/pages` locally via `wrangler pages dev` against the real Turso DB and verified end to end: `/api/health` OK, `/api/cameras` correctly 401s with no key and returns the seeded camera with a valid key, `/api/events` returns `[]`
- [ ] Deploy `apps/pages` to actual Cloudflare Pages (connect the repo, build output `apps/pages/public`), set env vars from `.dev.vars` in the dashboard (same values already verified locally)
- [ ] Open the deployed dashboard, paste the API key, confirm:
  - [ ] Camera shows up in the dropdown and the live view loads
  - [ ] PTZ buttons actually move the camera
  - [ ] Walking in front of the camera produces a row in "Sự kiện gần đây" within ~30s (AI worker not deployed yet, so this should alert on every motion — that's expected at this phase)
- [ ] Install `infra/launchd/*.plist` (macOS) or `infra/systemd/*.service`
      (Linux) for go2rtc + relay, confirm they survive a reboot

**Definition of done:** dashboard shows live video, PTZ works, a real
motion event produces a Telegram alert and a DB row, and killing/rebooting
the on-site machine brings everything back up on its own.

---

## Phase 2 — lock it down before leaving it running unattended

Goal: nothing about this should be safely ignorable once it's live 24/7.

- [ ] Put Cloudflare Access in front of go2rtc's public tunnel hostname
      (the browser's `<iframe>` hits it directly, bypassing the API's
      bearer-token auth — see the note in `docs/ARCHITECTURE.md`)
- [ ] Set `ALLOWED_ORIGINS` in Pages env vars to the actual dashboard
      domain instead of `*`, once the domain is final
- [ ] Turn on Cloudflare's rate limiting rules for the Pages domain
- [ ] Confirm `.env`, `cameras.json`, `.dev.vars` never made it into git
      (`git log --all --full-history -- '*.env' 'cameras.json' '.dev.vars'`
      should be empty)
- [ ] Set up an uptime check (UptimeRobot, healthchecks.io, etc.) against
      `GET /api/health`

**Definition of done:** an attacker who finds the tunnel hostname or the
Pages URL can't see video or data without a key, and you'd get paged if
either side goes down.

---

## Phase 3 — real AI person detection

Goal: stop alerting on every leaf blowing in the wind.

- [ ] Pick a model: YOLOv8n (nano) ONNX export is the default recommendation
- [ ] Implement `detect_person()` in `ai/worker/main.py` — start with
      `onnxruntime` CPUExecutionProvider (works everywhere), switch to
      CoreMLExecutionProvider later if the on-site box is Apple Silicon
      and CPU inference is too slow
- [ ] Deploy `ai/worker` on-site (same machine as the relay), expose via
      the same Cloudflare Tunnel
- [ ] Set `AI_WORKER_URL` in Pages env vars
- [ ] Test: motion with no person → no alert; motion with a person → alert,
      within the same ~30s budget as before

**Definition of done:** a week of normal household motion (pets, wind,
shadows) doesn't spam Telegram, but an actual person still does.

---

## Phase 4 — one real RunPod task

Goal: prove the heavy-GPU path end to end with one real, useful task,
rather than building all of them speculatively.

- [ ] Pick the first task (recommend: highlight-reel generation from a
      day's stored clips, since it's the most directly useful and doesn't
      require a face embedding model/dataset like face search would)
- [ ] Implement it in `runpod/heavy-worker/handler.py`
- [ ] Build + push the Docker image, create the RunPod Serverless endpoint
- [ ] Set `RUNPOD_API_KEY` / `RUNPOD_ENDPOINT_ID` in Pages env vars
- [ ] Test via `POST /api/jobs` → poll `GET /api/jobs/:id` → confirm result

**Definition of done:** one real task runs on RunPod, dispatched and
polled through `/api/jobs`, without touching the on-site machine.

---

## Phase 5 — second site (validates the multi-site design)

Goal: prove "add a site = insert rows, no code change" is actually true.

- [ ] Pick a second physical location (even a test setup is fine)
- [ ] Insert a second `sites` row + `cameras` row(s) under the same account
- [ ] Repeat the on-site setup from Phase 1 (own `cameras.json`, `.env`
      with a different `SITE_ID`, own Cloudflare Tunnel hostnames)
- [ ] Confirm both cameras show up in the same dashboard, under the same
      account, with no code changes needed

**Definition of done:** the answer to "can I add a site" is genuinely just
data entry, as designed.

---

## Backlog — deliberately not scheduled yet

These are real SaaS-productization work but depend on product decisions
(pricing, target customer, which auth/billing vendor) that shouldn't be
guessed. Revisit once there's an actual reason to onboard someone other
than the account owner.

- [ ] Customer signup/login flow (replace "paste an API key" with real
      auth — magic link, OAuth, or a provider like Clerk/Auth0)
- [ ] Billing integration (Stripe or similar) + plan/usage limits
- [ ] Admin UI for managing sites/cameras/API keys (currently: raw SQL
      against Turso)
- [ ] Per-site AI worker URLs (currently one global `AI_WORKER_URL` —
      fine at one-account scale, not once sites have different hardware)
- [ ] Structured JSON parsing of go2rtc's motion event schema instead of
      the substring match in `apps/relay`
