# Architecture

## Overview

```
Site A                                      Site B
[Cameras] --RTSP/ONVIF-->                   [Cameras] --RTSP/ONVIF-->
  [go2rtc localhost + relay]                  [go2rtc localhost + relay]
        |                                           |
  [1 Named Tunnel / 1 hostname]               [1 Named Tunnel / 1 hostname]
        +-------------------- Cloudflare ------------+
                          (outbound only; no ports)
                              |
                              v
                 Cloudflare Pages (apps/pages)
                 static dashboard + Functions:
                   /api/cameras   /api/events
                   /api/motion    /api/jobs
                              |
              +---------------+----------------+
              |               |                |
          [Turso]      [ai/worker on-site,   [RunPod Serverless]
      accounts, sites,   tunneled, called      (runpod/heavy-worker)
      cameras, events,    from /api/motion]    on-demand GPU
      jobs, api_keys
```

Everything that must physically sit near a camera is `go2rtc` +
`apps/relay` — a few hundred lines total. Everything else (accounts, UI,
API, DB, AI orchestration, RunPod dispatch) is centralized on Cloudflare
Pages and can be redeployed without touching anything on-site.

## Why this split

**Cloudflare Pages Functions can't run `go2rtc` or hold long-lived
connections.** They're stateless edge functions: no arbitrary binaries, no
raw TCP to a camera, no persistent SSE listener. That's a platform limit,
not a config choice — so `go2rtc` (media) and `apps/relay` (ONVIF PTZ +
motion-event forwarding) are the only things that have to run on real,
persistent compute near the camera. Everything else moved to Pages.

**Motion-gated, not continuous.** The camera's own ONVIF motion event
triggers everything downstream (snapshot → AI check → alert). Nothing
analyzes every frame of continuous video, and go2rtc only needs to pull
RTSP when a browser actually opens the live view. This is the biggest
lever for keeping bandwidth/CPU low across N sites.

**Multi-tenant from the start.** Every `site`, `camera`, `event`, and `job`
row belongs to an `account`. A relay only ever talks about *its own* site
(authenticated with that site's `relay_secret`); the Pages API only ever
returns rows scoped to the caller's account API key. Adding a second
customer, or a second site for the same customer, is a DB insert — no code
change. See `schema.sql`.

## Language choices

- **Node.js (`apps/relay`)** — kept intentionally tiny: ONVIF PTZ +
  forwarding motion events by webhook. No web UI, no DB, no Telegram
  anymore — those moved to Pages.
- **JavaScript, Cloudflare Workers runtime (`apps/pages/functions`)** — the
  entire API surface, using `@libsql/client/web` for Turso (same pattern
  already proven in the `hdtam` project). API-first: the dashboard is just
  another API client, so a future AI agent or external app can drive
  cameras/read events/dispatch jobs through the same endpoints — see
  `docs/API.md`.
- **Python (`ai/worker`, `runpod/heavy-worker`)** — all AI/ML. RunPod's SDK
  is Python-first, and so is essentially every relevant model ecosystem
  (YOLO, ONNX, face recognition).
- **Go (`go2rtc`)** — prebuilt binary, configured not coded.

## Two-tier AI

| | `ai/worker` | `runpod/heavy-worker` |
|---|---|---|
| Runs | On-site, called on every motion trigger | On-demand via `/api/jobs`, only when explicitly dispatched |
| Cost | Free (existing hardware) | Pay-per-second GPU |
| Latency budget | Must be fast (blocks the alert path) | Seconds–minutes is fine |
| Example tasks | "Is there a person in this frame?" | Face search across history, highlight reels, upscaling, batch re-analysis |

## Multi-tenant / SaaS readiness

- `accounts` + `api_keys` (key stored as a SHA-256 hash, never plaintext)
  give each customer isolated data and their own credential.
- Every query in `apps/pages/functions` is scoped by `data.accountId`,
  resolved once in `functions/_middleware.js` and never trusted from the
  client.
- `sites.id` / `cameras.id` must be globally unique (prefixed with the
  account id) because `/api/motion` looks a site up without an account
  filter — the relay authenticates with a site secret, not a customer key.
- Email/password signup/login, Stripe billing and plan limits are implemented.
  Platform billing secrets stay server-side; customer Telegram/RunPod keys
  are encrypted account settings.

## Production-hardening choices

- **Consistent error handling**: every Pages Function route is wrapped in
  `withErrorHandling` (`functions/_lib/http.js`) so thrown errors become
  `{ "error": ... }` JSON with a real status code instead of leaking a
  stack trace or Cloudflare's generic error page.
- **CORS + auth in one place**: `functions/_middleware.js` handles both,
  so no individual route can accidentally skip either.
- **`/api/health`**: unauthenticated, checks Turso connectivity, for
  uptime monitors.
- **Tenant isolation for jobs**: `jobs` table tracks `account_id` per
  dispatched RunPod job so `GET /api/jobs/:id` can't leak another
  account's job status — this was a gap in an earlier pass, closed before
  calling it production-ready.
- **Process supervision**: `infra/launchd` (macOS) and `infra/systemd`
  (Linux) — a site's on-prem machine won't always be a Mac.
- **Secrets**: nothing in git. `.env` files, `cameras.json`, `.dev.vars`
  are all gitignored; production secrets live in Cloudflare Pages'
  encrypted environment variables and in Turso rows, not in the repo.
- **Deploy path**: use Cloudflare Pages' native git integration (build
  output `apps/pages/public`) rather than a bespoke CI pipeline — it
  already gives preview deployments per branch/PR and instant rollback,
  which is more than a custom GitHub Actions workflow would add here.
- **Abuse prevention**: use Cloudflare's built-in rate limiting rules on
  the Pages domain rather than hand-rolling a limiter in a Worker — the
  platform already does this well.

## MVP tunnel and live-view boundary

- Each site owns one Named Tunnel, one connector token and one hostname:
  `https://<site-id>.<TUNNEL_BASE_DOMAIN>`.
- cloudflared sends that hostname only to `127.0.0.1:4000` (the relay).
  go2rtc binds `127.0.0.1:1984`; the AI worker is also an internal origin.
- A SaaS-authenticated client calls `POST /api/cameras/:site/:camera/live`.
  Pages signs a five-minute HMAC capability containing version, site,
  go2rtc stream name, expiry, nonce and the account plan's viewer limit.
  The relay validates it before proxying
  `stream.html`, its static assets and `/api/ws` WebRTC signaling.
- The relay counts active WebRTC signaling sockets per camera. Free allows
  1 concurrent viewer/camera and Pro allows 5; excess connections get HTTP
  429. The counter is local because MVP has one relay process per site.
- Capture and AI requests use `/internal/go2rtc/*` and `/internal/ai/*`
  with the site's relay secret. These paths reject browser/customer calls.
- Cloudflare Access is intentionally absent from the customer flow. It
  therefore consumes no Access user seats and customers need no Google or
  Cloudflare identity.

## Tunnel lifecycle and quota monitoring

- An hourly GitHub Actions job calls `POST /api/internal/maintenance` with a
  dedicated `MAINTENANCE_SECRET`; customer API keys cannot invoke it.
- It compares `cameraaiwork-*` tunnels with IDs referenced by `sites`. Only
  unreferenced product tunnels older than the six-hour grace period are
  deleted with matching CNAME records. Unrelated tunnels and new provisioning
  attempts remain untouched.
- It reports managed and account-wide Tunnel/DNS counts. Configurable safety
  thresholds default to 900 and return HTTP 503 so the workflow visibly fails
  before capacity is exhausted. They are operational thresholds, not claims
  about a fixed Cloudflare vendor quota.
- Cloudflare Access is reserved for owner/admin operational tools only.

## Stability checklist (per site)

- `go2rtc` and `apps/relay` both run under a process supervisor
  (launchd/systemd) that restarts on crash and reboot.
- `cloudflared` (or Tailscale) handles the on-site ↔ Cloudflare link with
  automatic reconnect — no manual port forwarding.
- Verify unsigned `/live/*` and `/internal/*` requests return 401, while a
  freshly minted signed live URL loads and negotiates WebRTC.
- Remote WebRTC media still needs a network path selected by ICE. If direct
  UDP/TCP candidates cannot traverse a site's NAT/firewall, configure a TURN
  server; the HTTP Cloudflare Tunnel carries signaling, not arbitrary UDP.

## Known issues carried over from the original single-camera code

- The very first version of `go2rtc.yaml` and `server.js` disagreed on the
  camera's LAN IP. Fixed by generating `go2rtc.yaml` from a single source
  of truth (`apps/relay/cameras.json`) instead of hand-editing two files.
- Motion detection matches on raw substrings in the SSE payload
  (`data.includes('motion')`) in `apps/relay`. Works, but fragile — worth
  switching to a proper JSON parse of go2rtc's event schema if false
  positives show up in practice.
