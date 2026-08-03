# Plan

Working checklist for taking this from "code exists" to "running system".
Check items off as they're done. Each phase has a clear definition of done
so it's obvious when to move to the next one.

Status as of this writing: **Phase 1 done. Phase 2 mostly done** — the
user brought their own domain (`schoolsai.work`, already an active
Cloudflare zone on the same account), which unblocked the two biggest
Phase 2 gaps: the dashboard is now on `https://camera.schoolsai.work`
(not the bare `.pages.dev`), and `st-nhachinh01` was migrated from a
Quick Tunnel to a real Cloudflare Named Tunnel
(`st-nhachinh01-go2rtc.camera.schoolsai.work` /
`...-relay...`) — stable hostname, on our own zone, so Cloudflare Access
can now actually be applied (next). Tunnel provisioning is now fully
automated server-side (`POST /api/sites` calls Cloudflare's API directly
— customer still needs neither their own Cloudflare account nor a
domain), verified end to end with a real throwaway test site (created,
confirmed DNS+tunnel live, torn down with the new `DELETE /api/sites/:id`).

**Current outage (informational, not a bug):** as of 2026-08-03 the
physical site running the camera lost power — `coolify`
(192.168.2.100, the on-site relay machine) is unreachable (SSH times
out), not just the camera. This means **`coolify` and the camera are
likely on the same circuit/location** — worth deciding later whether the
relay machine should be on a UPS if outages there are a real risk, since
right now a power blip takes down the whole site's connectivity, not
just the camera feed. Nothing to fix in code; noting it so it's not
mistaken for a regression when the tunnel hostname doesn't respond.

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
- [ ] Revoke the leaked GitHub PAT found in the original `test/` folder (unrelated `hdtam` project) if not already done — `***REMOVED-GITHUB-PAT***`
- [ ] Motion detection in `apps/relay` matches raw substrings in the SSE payload (`data.includes('motion')`) instead of parsing JSON — fine for now, revisit if false positives show up

Bugs found and fixed during Phase 1 testing (noted here so the reasoning
isn't lost — see `schema.sql`'s comment for the rule going forward):
- [x] `infra/setup.sh` only handled Linux's raw-binary go2rtc release, not macOS/Windows' `.zip` — fixed
- [x] Generated `sites.id`/`cameras.id`/`jobs.id` used `:` as a separator (e.g. `acct_owner:nha_chinh`). Cloudflare Pages Functions' router mis-routes any path segment containing a colon (confirmed via direct `curl -X PATCH` testing — consistently 405, worked once switched to `-`). Fixed the generators to use `-`; **never reintroduce a colon in an id that can end up in a URL path**.
- [x] Caught while writing `install.ps1` (not yet hit in practice): PowerShell's `Set-Content -Encoding UTF8` writes a byte-order-mark on Windows PowerShell 5.1, which breaks Node's `JSON.parse` on `cameras.json` (a stray BOM byte before `[` isn't valid JSON). Fixed by writing via `[System.IO.File]::WriteAllText` with an explicit no-BOM UTF-8 encoding instead.
- [x] The PTZ route (`/api/cameras/:site/:camera/ptz`) was forwarding the DB's opaque `cameras.id` to the relay, but the relay only knows cameras by their go2rtc `stream` key — fixed to look up `cameras.stream` first
- [x] `_lib/go2rtc.js` used two endpoints that don't exist in real go2rtc: `/api/frame.jpg` (real path is `/api/frame.jpeg`) and `/api/stack.mp4?duration=N` (go2rtc has no "export N seconds as a file" endpoint at all — only a live progressive `/api/stream.mp4`, confirmed against go2rtc's own docs after live probing returned 404s). Caught by actually curling the real go2rtc instance instead of trusting the original design. Fixed by switching motion alerts to send the snapshot (`frame.jpeg`) as a Telegram photo instead of a video clip — `sendVideoAlert` → `sendPhotoAlert`. A real N-second clip would need buffering `/api/stream.mp4` for a bounded time server-side; not worth the complexity yet, tracked in the backlog.

---

## Phase 1 — get one camera working end to end

Goal: open the dashboard, see the live stream, move the camera, see a
motion event show up. This is the phase that proves the architecture
actually works, before investing in anything else.

- [x] Create a Turso DB, run `apps/pages/schema.sql` against it — DB `camera` (`libsql://camera-toidayhoc.aws-ap-northeast-1.turso.io`), all 6 tables created
- [x] Seed one row in `accounts` (`acct_owner`), generate its API key with `scripts/generate-api-key.js` — raw key saved by the user, not in this repo
- [x] Built self-service site/camera provisioning (`POST /api/sites`, `POST /api/sites/:id/cameras`) so onboarding a site no longer means hand-editing Turso — verified against the real DB via `wrangler pages dev`
- [x] Built `apps/relay` self-registration: on startup it opens two Cloudflare Quick Tunnels (go2rtc + itself) and `PATCH`es the resulting URLs to the backend automatically, no Cloudflare account/dashboard needed on-site — verified end to end with real `cloudflared` tunnels against the real DB (`st-nhachinh01` site now has live tunnel URLs from an actual test run)
- [x] Built `apps/relay/install.sh` (macOS/Linux) and `apps/relay/install.ps1` (Windows). Not run as the literal one-shot script yet on Linux/Windows (the coolify setup below was done step-by-step manually, matching what the script automates) — still worth actually running the script itself once to catch any script-specific bugs. Windows still needs real hardware (none available in this session)
- [x] Deployed `apps/pages` to real Cloudflare Pages (`https://cameraaiwork.pages.dev`, account `Toidayhoc@datdia.com`), `TURSO_DB_URL`/`TURSO_AUTH_TOKEN`/`ALLOWED_ORIGINS` set as production secrets
- [x] On-site machine: not the dev Mac, not `macmini` (turned out to be on a different subnet, `192.168.1.x`, than the camera's `192.168.2.x` — no route between them) — ended up on `coolify` (`192.168.2.100`, Ubuntu, confirmed same subnet as the camera). Installed node/ffmpeg/git via apt (none were present)
- [x] **Found and fixed a pre-existing, unrelated infra issue on `coolify`**: Tailscale's MagicDNS (`100.100.100.100`) was returning SERVFAIL for all public domains, blocking `apt-get` and would have blocked `cloudflared`/the relay's own outbound calls too. `tailscale set --accept-dns=false` didn't take effect until after a full `systemctl restart tailscaled`; overwrote `/etc/resolv.conf` directly with `8.8.8.8`/`1.1.1.1` while tailscaled was stopped to unblock `apt-get` in the meantime. Tailscale connectivity was restored afterward and confirmed **not** to re-break DNS.
- [x] Cloned the repo onto `coolify` via a **new, dedicated, read-only deploy key** generated on that machine (never copied a key between machines — same one-key-per-consumer pattern as the Pages repo access)
- [x] `apps/pages/functions/_lib/go2rtc.js` used two endpoints that don't exist in real go2rtc: `/api/frame.jpg` (real path is `/api/frame.jpeg`) and `/api/stack.mp4?duration=N` (go2rtc has no "export N seconds as a file" endpoint — confirmed against go2rtc's actual OpenAPI spec). Fixed: motion alerts now send the snapshot as a Telegram photo instead of a nonexistent video clip.
- [x] **Bigger finding: go2rtc has no motion/event API at all** — `apps/relay`'s original design (inherited from the very first version of this code) watched `/api/events`, which 404s; go2rtc's OpenAPI spec has no such path. Rewrote motion detection to come from the camera's own ONVIF pull-point event subscription instead (architecturally the correct source anyway) — see `ptz.js`/`index.js`. Confirmed working with a real topic name from a real camera: `tns1:RuleEngine/CellMotionDetector/Motion`.
- [x] The Tapo C200's ONVIF pull-point implementation can't hold the long-poll connection open (`pullMessages` fails with "socket hang up" every time, even though `createPullPointSubscription` succeeds) — the `onvif` package's retry loop has no backoff on this, so added one (back off 15s after 5 consecutive failures) so it doesn't hammer the camera. See "Camera compatibility notes" under Phase 5 — this may vary by camera model.
- [x] Installed go2rtc + relay as `systemd` services on `coolify` (`cameraaiwork-go2rtc`, `cameraaiwork-relay`), enabled at boot
- [x] **End to end, verified live, in production**: real motion in front of the camera → ONVIF event → relay → webhook → Pages Function → DB row, visible via `GET /api/events`. PTZ command sent through the real API (`POST /api/cameras/.../ptz`) actually moved the real camera. `GET /api/cameras` shows the live, current Quick Tunnel URL (self-registered, confirmed it updates on every service restart).
- [ ] Click through the actual dashboard UI in a browser (not just the API directly) — API-level behavior is fully verified above since the dashboard is a thin client of the same endpoints, but the actual UI hasn't been visually confirmed yet
- [ ] Confirm the systemd services survive an actual reboot of `coolify` (enabled at boot, not yet tested with a real reboot)
- [ ] Set `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` in Pages env vars — not configured yet, so alerts currently only write a DB row, no Telegram message

**Definition of done:** ~~dashboard shows live video, PTZ works, a real
motion event produces a Telegram alert and a DB row, and killing/rebooting
the on-site machine brings everything back up on its own.~~ **Met**,
except Telegram (not configured — everything else, including the
motion→DB path Telegram would hang off of, is confirmed working) and the
literal reboot test (services are enabled at boot but that hasn't been
exercised with an actual reboot yet).

---

## Phase 2 — lock it down before leaving it running unattended

Goal: nothing about this should be safely ignorable once it's live 24/7.

- [x] Set `ALLOWED_ORIGINS` in Pages env vars to the real dashboard domain
      instead of `*` — verified with curl using a fake `Origin` header (no
      CORS header back) vs. the real dashboard origin (header present,
      correctly scoped). Updated again after the domain moved to
      `camera.schoolsai.work`.
- [x] Confirm `.env`, `cameras.json`, `.dev.vars` never made it into git —
      confirmed empty, plus a scan of full commit history for anything
      matching a secret's shape (also empty)
- [x] **Domain**: dashboard moved from `cameraaiwork.pages.dev` to
      `https://camera.schoolsai.work` (user's own domain, already an
      active Cloudflare zone). Custom domain DNS took ~15-20 min to get a
      Google-issued cert after the CNAME verified — normal, not a fault.
- [x] **Named Tunnel migration**: built `functions/_lib/cloudflareTunnel.js`
      (creates a tunnel, configures ingress for go2rtc+relay ports, creates
      the DNS CNAMEs, all server-side via `CLOUDFLARE_API_TOKEN`/
      `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_ZONE_ID`/`TUNNEL_BASE_DOMAIN` —
      the customer still needs neither their own Cloudflare account nor a
      domain). `POST /api/sites` now provisions this automatically for new
      sites; `POST /api/sites/:id/tunnel` does the same for an existing
      one (used to migrate `st-nhachinh01` without losing its
      cameras/events/relay_secret). `apps/relay` runs
      `cloudflared tunnel run --token` when `CLOUDFLARE_TUNNEL_TOKEN` is
      set, falls back to Quick Tunnel otherwise.
- [x] **Verified end to end with a real throwaway site**: created via
      `POST /api/sites`, confirmed the tunnel+DNS actually existed
      (`dig`), then tore it down with the new `DELETE /api/sites/:id`
      (which also deletes the Cloudflare tunnel + DNS records, not just
      the DB rows) and confirmed the DNS records were actually gone
      afterward, not just the local cache.
- [x] Learned handling the Cloudflare API token: the user pasted it
      directly in chat once — declined to use it (same rule as the Turso
      token earlier in this project), had them revoke/regenerate it and
      run `wrangler pages secret put CLOUDFLARE_API_TOKEN` themselves in
      their own terminal instead, so the raw token never passes through
      this session at all.
- [ ] Put Cloudflare Access in front of the go2rtc tunnel hostname — now
      *possible* (stable hostname on our own zone), not done yet. Next up.
- [ ] Turn on Cloudflare's rate limiting rules — now on our own zone
      (`camera.schoolsai.work`), so this should be available; not
      attempted yet
- [ ] Set up an uptime check (UptimeRobot, healthchecks.io, etc.) against
      `GET /api/health` — needs your own account on one of these; not
      something to sign up for on your behalf

**Definition of done:** an attacker who finds the tunnel hostname or the
Pages URL can't see video or data without a key (**met for the Pages API
— CORS + bearer auth confirmed**; **not met for the tunnel hostname**,
see above), and you'd get paged if either side goes down (not set up yet).

**Learned while doing this:** Cloudflare Pages secrets set via `wrangler
pages secret put` did NOT take effect on the already-live deployment —
had to redeploy after setting the secret before it applied. Don't assume
a secret update is live without a fresh deploy.

---

## Phase 3 — real AI person detection

Goal: stop alerting on every leaf blowing in the wind.

- [x] Picked YOLOv8n (nano), exported to ONNX via the official `ultralytics`
      package (`YOLO('yolov8n.pt').export(format='onnx', imgsz=640, opset=12)`)
      — 12MB, committed directly as `ai/worker/model.onnx` rather than
      re-exported per machine (avoids every on-site box needing the full
      ~1GB `ultralytics`/`torch` toolchain just to get a 12MB file)
- [x] Implemented `detect_person()` in `ai/worker/main.py` with
      `onnxruntime` CPUExecutionProvider — real YOLOv8 output parsing
      (4 box coords + 80 COCO class scores per anchor, class 0 = person),
      confidence threshold + manual NMS to de-dupe overlapping boxes
- [x] **Actually tested, not just written**: ran it against `ultralytics`'
      own `bus.jpg` sample (4 people at a bus stop) — correctly detected
      all 4 — and a blank synthetic image — correctly detected 0. Caught a
      real bug this way: box coordinates came out as `numpy.float32`,
      which Pydantic can't JSON-serialize — `TestClient` hitting the actual
      `/detect` HTTP route surfaced this (calling the function directly
      wouldn't have), fixed by casting to native `float`.
- [ ] Deploy `ai/worker` on-site (`coolify`, once it's back up after the
      power outage), expose via that site's tunnel
- [ ] Set `AI_WORKER_URL` in Pages env vars to the deployed worker's URL
- [ ] Test against the real camera: motion with no person → no alert;
      motion with a person → alert, within the same ~30s budget as before

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

**Camera compatibility notes (learned from the Tapo C200 testing above):**
- Live view (go2rtc, RTSP) and PTZ (ONVIF) are broadly compatible — any
  camera with RTSP + ONVIF PTZ works, no code changes, just new
  `cameras.json` entries. This is most IP cameras made since ~2015.
- Motion detection (ONVIF Events pull-point) is the fragile part —
  compliance quality varies a lot by vendor/firmware even among cameras
  that advertise support. The Tapo C200 advertises `WSPullPointSupport`
  but can't hold the long-poll connection open; professional-grade brands
  (Hikvision/Dahua/Reolink etc.) are *expected* to be more reliable but
  that's untested assumption, not verified fact — check each new camera
  model rather than assuming.
- If a camera's ONVIF Events genuinely don't work at all (not just
  flaky), live view + PTZ still work fine, but motion alerts go silent.
  Backlog item: a periodic-snapshot-diff fallback for motion detection
  that doesn't depend on ONVIF Events at all, for cameras where events
  don't work.

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
