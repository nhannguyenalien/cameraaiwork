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
Response (`201`): `{ "siteId": "st-...", "relaySecret": "..." }` — the
installer writes `relaySecret` into the relay's local `.env`; it's never
shown again. `go2rtc_url`/`relay_url` start empty and are filled in
automatically by the relay itself (see `PATCH /api/sites/:id` below). Used
by `apps/relay/install.sh` — you normally don't call this directly.

## `POST /api/sites/:id/cameras`

Register a camera under a site. Body: `{ "stream": "cam1", "name": "Sân vườn" }`
(`stream` must match the go2rtc stream name / the camera's `id` in that
site's `cameras.json`). Response (`201`): `{ "cameraId": "cam-..." }`.

## `PATCH /api/sites/:id` (internal — not for UI/API clients)

Called by a site's relay on every startup to report its current Cloudflare
Quick Tunnel URLs (they change every restart). Authenticated with that
site's `relay_secret` (header `x-relay-secret`), not an account API key.
Body: `{ "go2rtcUrl": "...", "relayUrl": "..." }`.

## `GET /api/cameras`

List every camera the account can see, across all its sites.

```json
[
  {
    "cameraId": "acct_owner:nha_chinh:tapo",
    "stream": "tapo",
    "cameraName": "Camera chính",
    "siteId": "acct_owner:nha_chinh",
    "siteName": "Nhà chính",
    "go2rtcUrl": "https://go2rtc-nhachinh.yourdomain.com"
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

Returns the most recent motion/person events, newest first.

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
