# Plan

Working checklist for taking this from "code exists" to "running system".
Check items off as they're done. Each phase has a clear definition of done
so it's obvious when to move to the next one.

Status as of this writing: **Turso DB is live and seeded. On-site setup is
now a single command on any of macOS (`install.sh`), Linux (`install.sh`),
or Windows (`install.ps1`) — self-registers the site/camera with the
backend and self-exposes go2rtc+relay via Cloudflare Quick Tunnels, no
manual Cloudflare or Turso steps. macOS has been verified end to end
against a real camera and the real Turso DB. Linux and Windows follow the
identical logic and every third-party download URL involved has been
verified to actually resolve, but neither has been run start-to-finish on
real hardware. The actual Cloudflare Pages deployment also hasn't been
done yet — everything so far has been tested against `wrangler pages dev`
standing in for it.**

---

## Phase 0 — what already exists (recap, no action needed)

- [x] `apps/relay` — ONVIF PTZ + motion webhook forwarder, multi-camera per site
- [x] `apps/pages` — Cloudflare Pages Functions API (cameras/events/jobs/motion/health) + Tabler dashboard, multi-tenant, backed by Turso
- [x] `ai/worker` — FastAPI stub, `detect_person()` not implemented yet
- [x] `runpod/heavy-worker` — RunPod handler stub, no task implemented yet
- [x] `schema.sql`, `docs/ARCHITECTURE.md`, `docs/API.md`, `README.md`
- [x] `infra/` — setup.sh, launchd (macOS) + systemd (Linux) service templates
- [x] `apps/relay/install.ps1` + `apps/relay/win/*` — Windows installer + Windows Service wrappers (via `node-windows`, since there's no launchd/systemd equivalent)
- [x] Pushed to `github.com/nhannguyenalien/cameraaiwork`

Known debt carried in from the original code, not yet fixed:
- [ ] Revoke the leaked GitHub PAT found in the original `test/` folder (unrelated `hdtam` project) if not already done — `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`
- [ ] Motion detection in `apps/relay` matches raw substrings in the SSE payload (`data.includes('motion')`) instead of parsing JSON — fine for now, revisit if false positives show up

Bugs found and fixed during Phase 1 testing (noted here so the reasoning
isn't lost — see `schema.sql`'s comment for the rule going forward):
- [x] `infra/setup.sh` only handled Linux's raw-binary go2rtc release, not macOS/Windows' `.zip` — fixed
- [x] Generated `sites.id`/`cameras.id`/`jobs.id` used `:` as a separator (e.g. `acct_owner:nha_chinh`). Cloudflare Pages Functions' router mis-routes any path segment containing a colon (confirmed via direct `curl -X PATCH` testing — consistently 405, worked once switched to `-`). Fixed the generators to use `-`; **never reintroduce a colon in an id that can end up in a URL path**.
- [x] Caught while writing `install.ps1` (not yet hit in practice): PowerShell's `Set-Content -Encoding UTF8` writes a byte-order-mark on Windows PowerShell 5.1, which breaks Node's `JSON.parse` on `cameras.json` (a stray BOM byte before `[` isn't valid JSON). Fixed by writing via `[System.IO.File]::WriteAllText` with an explicit no-BOM UTF-8 encoding instead.
- [x] The PTZ route (`/api/cameras/:site/:camera/ptz`) was forwarding the DB's opaque `cameras.id` to the relay, but the relay only knows cameras by their go2rtc `stream` key — fixed to look up `cameras.stream` first

---

## Phase 1 — get one camera working end to end

Goal: open the dashboard, see the live stream, move the camera, see a
motion event show up. This is the phase that proves the architecture
actually works, before investing in anything else.

- [x] Create a Turso DB, run `apps/pages/schema.sql` against it — DB `camera` (`libsql://camera-toidayhoc.aws-ap-northeast-1.turso.io`), all 6 tables created
- [x] Seed one row in `accounts` (`acct_owner`), generate its API key with `scripts/generate-api-key.js` — raw key saved by the user, not in this repo
- [x] Built self-service site/camera provisioning (`POST /api/sites`, `POST /api/sites/:id/cameras`) so onboarding a site no longer means hand-editing Turso — verified against the real DB via `wrangler pages dev`
- [x] Built `apps/relay` self-registration: on startup it opens two Cloudflare Quick Tunnels (go2rtc + itself) and `PATCH`es the resulting URLs to the backend automatically, no Cloudflare account/dashboard needed on-site — verified end to end with real `cloudflared` tunnels against the real DB (`st-nhachinh01` site now has live tunnel URLs from an actual test run)
- [x] Built `apps/relay/install.sh` (macOS/Linux) and `apps/relay/install.ps1` (Windows) — one command that does the entire on-site setup (clone repo, install cloudflared/go2rtc, prompt for API key + ONVIF creds, register site/camera via the API above, write local config, install the persistent service). Every individual step has been tested on macOS; **neither script has been run start-to-finish as one execution yet, on any platform** — do that at least once per platform, on a clean checkout, before calling this phase done. Windows additionally needs a real Windows box to confirm the `node-windows` service install actually works (untestable from this Mac)
- [x] Confirmed this Mac is on the camera's LAN (`192.168.2.25` vs camera `192.168.2.23`) and, during testing, ONVIF successfully connected (`✅ ONVIF PTZ sẵn sàng: tapo`) — the camera was briefly online; re-verify it's reachable when running the real install
- [ ] Run `apps/relay/install.sh` for real (or re-point the existing `st-nhachinh01` site's config at it) once the camera is confirmed on, and let it install itself as a persistent service
- [ ] Deploy `apps/pages` to actual Cloudflare Pages (connect the repo, build output `apps/pages/public`), set env vars from `.dev.vars` in the dashboard (same values already verified locally against `wrangler pages dev`)
- [ ] Point `apps/relay/.env`'s `PAGES_API_URL` (or re-run the installer) at the real Pages URL instead of `localhost:8788`
- [ ] Open the deployed dashboard, paste the API key, confirm:
  - [ ] Camera shows up in the dropdown and the live view loads
  - [ ] PTZ buttons actually move the camera
  - [ ] Walking in front of the camera produces a row in "Sự kiện gần đây" within ~30s (AI worker not deployed yet, so this should alert on every motion — that's expected at this phase)
- [ ] Confirm the launchd services (installed by `install.sh`) survive a reboot

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
- [ ] Run `apps/relay/install.sh` there with the same account API key —
      this is now the actual test of "no code change", not manual DB inserts
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
- [ ] ONVIF auto-discovery in the installers (scan the LAN and suggest
      cameras) instead of asking for IP/user/password by hand
- [ ] Native GUI installer (.pkg/.exe/.msi) for non-technical customers —
      the curl/irm one-liners are the right MVP (same pattern as
      Homebrew/Tailscale/winget itself), a packaged installer is worth the
      extra effort once there's real non-technical customer volume to
      justify it
- [ ] Upgrade Quick Tunnels to Cloudflare named tunnels (stable hostname,
      provisioned server-side via the Cloudflare API) once this needs to be
      rock-solid production infra rather than "customer just installed it" —
      Quick Tunnels explicitly aren't meant for permanent production use
      per Cloudflare's own disclaimer
