# API

Base URL: your Cloudflare Pages domain (e.g. `https://cameraaiwork.pages.dev`).

All endpoints except `/api/motion` and `/api/health` require:

```
Authorization: Bearer <account API key>
```

Get a key with `apps/pages/scripts/generate-api-key.js` (see
[README](../README.md)). Every response is scoped to the account that key
belongs to — there is no way to see another account's sites, cameras,
events, or jobs.

CORS is open by default (`ALLOWED_ORIGINS=*`); restrict it in the Pages
project's env vars if you want to lock the API to specific origins.

## `POST /api/sites`

Register a new site under the caller's account. Body: `{ "name": "Nhà chính" }`.
Provisions a real Cloudflare Named Tunnel server-side (our domain — the
customer needs neither their own Cloudflare account nor a domain; requires
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_ZONE_ID`/
`TUNNEL_BASE_DOMAIN` set in the Pages project's env vars). Response
(`201`): `{ "siteId": "st-...", "relaySecret": "...", "tunnelToken": "..." }`
— the installer writes both into the relay's local `.env`; neither is
shown again. Used by `apps/relay/install.sh` — you normally don't call
this directly.

## `POST /api/sites/:id/cameras`

Register a camera under a site. Body: `{ "stream": "cam1", "name": "Sân vườn" }`
(`stream` must match the go2rtc stream name / the camera's `id` in that
site's `cameras.json`). Response (`201`): `{ "cameraId": "cam-..." }`.

## `POST /api/sites/:id/tunnel`

Provisions (or re-provisions) a named tunnel for a site that already
exists — e.g. migrating one still on a Quick Tunnel fallback. Doesn't
touch cameras/events/`relay_secret`. Response:
`{ "tunnelToken": "...", "go2rtcUrl": "...", "relayUrl": "..." }` — write
`tunnelToken` into that site's relay `.env` (`CLOUDFLARE_TUNNEL_TOKEN`)
and restart it.

## `PATCH /api/sites/:id` (internal — not for UI/API clients)

Called by a site's relay on every startup to report its current Quick
Tunnel URLs — only relevant for sites falling back to Quick Tunnel (no
`CLOUDFLARE_API_TOKEN` configured on the backend); named-tunnel sites
don't need this since the hostname is already stable. Authenticated with
that site's `relay_secret` (header `x-relay-secret`), not an account API
key. Body: `{ "go2rtcUrl": "...", "relayUrl": "..." }`.

## `DELETE /api/sites/:id`

Tears down the site's Cloudflare Tunnel + DNS records (if any) and
deletes it, along with its cameras and events (no FK cascade, deleted
explicitly).

## `GET /api/cameras`

List every camera the account can see, across all its sites.

```json
[
  {
    "cameraId": "cam-4f2e9b1c0a3d",
    "stream": "tapo",
    "cameraName": "Camera chính",
    "siteId": "st-7789da83f1a2",
    "siteName": "Nhà chính",
    "go2rtcUrl": "https://st-7789da83f1a2-go2rtc.yourdomain.com"
  }
]
```

## `POST /api/cameras/:site/:camera/ptz`

Body: `{ "direction": "up" | "down" | "left" | "right" | "stop" }`

Forwards the command to that site's relay over its Cloudflare Tunnel.
`404` if the site doesn't exist (or doesn't belong to your account), `502`
if the relay is unreachable.

## `GET /api/events`

Query params (all optional): `site`, `camera`, `limit` (default 20, max 100).

Returns the most recent motion/person events, newest first, each with
`person_id`/`person_label` (both `null` if the AI worker isn't deployed,
or no face was visible in the frame — e.g. the camera angle cropped it
out).

## `GET /api/people`

List every clustered person for the account, most recently seen first.
`label` is `null` until named (see `PATCH /api/people/:id`) — the UI
shows those as unnamed until then. Never includes the raw embedding
(biometric data, no reason to expose it to a client).

```json
[
  {
    "id": "person-4f2e9b1c0a3d",
    "label": "Bố",
    "first_seen_at": "2026-08-01 09:12:00",
    "last_seen_at": "2026-08-03 09:58:04",
    "seen_count": 7
  }
]
```

## `PATCH /api/people/:id`

Name a clustered person. Body: `{ "label": "Bố" }` (empty/omitted clears
it back to unnamed).

## `POST /api/jobs`

Dispatch a heavy async task (currently RunPod only).

Body: `{ "type": "runpod", "task": "face_search", ...anything else the handler needs }`

Response (`202`): `{ "id": "runpod-abc123", "status": "queued" }`

## `GET /api/jobs/:id`

Poll job status. `404` if the job doesn't exist or belongs to a different
account.

## `POST /api/motion` (internal — not for UI/API clients)

Called by a site's relay when go2rtc reports motion. Authenticated with
that site's `relay_secret` (header `x-relay-secret`), not an account API
key. Body: `{ "siteId": "...", "camera": "..." }`.

## `GET /api/health`

Unauthenticated. Checks Turso connectivity. For uptime monitors.

## Errors

Every error response is `{ "error": "message" }` with an appropriate HTTP
status (`400` bad input, `401` unauthorized, `404` not found, `502`/`503`
upstream unavailable, `500` unexpected).
