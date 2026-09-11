# CameraAI API

Canonical machine-readable contract: [`openapi.yaml`](./openapi.yaml). Production publishes the same file at `https://<dashboard>/openapi.yaml`.

## Quick start

```bash
export CAMERAAI_API='https://cameraaiwork.pages.dev'
export CAMERAAI_TOKEN='paste-account-session-key'

curl -fsS "$CAMERAAI_API/api/settings/account" \
  -H "Authorization: Bearer $CAMERAAI_TOKEN"
curl -fsS "$CAMERAAI_API/api/cameras" \
  -H "Authorization: Bearer $CAMERAAI_TOKEN"
```

Signup and login return the bearer token:

```bash
curl -fsS -X POST "$CAMERAAI_API/api/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"email":"owner@example.com","password":"a-long-password"}'
```

Send `Authorization: Bearer <token>` on all customer endpoints. Logout revokes that token. Never put it in URLs, logs, prompts, source control, or a camera machine shared by multiple customers.

## Endpoint map

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/signup`, `/login`, `/logout` |
| Account | `GET /api/settings/account`; API keys: `GET/POST /api/settings/api-keys`, `DELETE /api/settings/api-keys/{id}` |
| Sites | `GET/POST /api/sites`, `DELETE /api/sites/{id}`, `POST /api/sites/{id}/discover` (scan LAN for ONVIF cameras) |
| Cameras | `GET /api/cameras`, `POST /api/sites/{id}/cameras`; camera `GET/PATCH/DELETE`, settings and config |
| Control | Camera `GET /status`, `/snapshot`, `/controls`; `POST /live`, `/ptz`, `/talk` |
| Events/people | Event list/detail/media, `PATCH/DELETE /api/events/{id}`, `DELETE /api/events/bulk`; people list/update |
| Integrations/jobs | `GET/PUT/DELETE /api/settings/integrations`, `POST /api/settings/integrations/models` (validate a key, list its models), `POST /api/jobs`, `GET /api/jobs/{id}` |
| Storage | `GET /api/settings/storage` (usage report), `GET/PUT /api/settings/storage-config` (R2/S3/Google Drive backend) |
| Billing | `POST /api/billing/checkout`, `/portal`; `POST /api/auth/stripe-webhook` (Stripe-signed, not for customer use) |
| Operations | `GET /api/health`; internal `/api/motion`, `/api/face-backfill`, `/api/internal/maintenance`, `/api/internal/patrol` |

See OpenAPI for bodies, response schemas, operation IDs and examples.

## Streaming and PTZ

`POST /api/cameras/{site}/{camera}/live` returns a five-minute signed capability URL plus `expiresAt` and `viewerLimit`. Request a new URL shortly before expiry; do not persist or share it. Relay enforcement is currently Free: 1 and Pro: 5 concurrent viewers per camera.

```bash
curl -fsS -X POST "$CAMERAAI_API/api/cameras/st-example/cam1/live" \
  -H "Authorization: Bearer $CAMERAAI_TOKEN"

curl -fsS -X POST "$CAMERAAI_API/api/cameras/st-example/cam1/ptz" \
  -H "Authorization: Bearer $CAMERAAI_TOKEN" \
  -H 'Content-Type: application/json' --data '{"action":"left","speed":0.5,"durationMs":500}'
```

PTZ accepts `up`, `down`, `left`, `right`, `zoomIn`, `zoomOut`, `stop`, `home`, `gotoPreset`, and `setPreset`. `direction` remains accepted for older clients. Movement automatically stops after `durationMs`.

## Event queries

`GET /api/events` supports `site`, `camera`, `type`, `person`, `videoStatus`, `faceScanStatus`, `acknowledged`, `from`, `to`, `limit`, `page`, and `cursor`. The response remains an array for compatibility. Use `page` for numbered pagination (`X-Total-Count`, `X-Total-Pages`, `X-Current-Page`) or `cursor` for continuation pagination (`X-Next-Cursor`, `X-Has-More`), but not both. Authorized MP4 responses support the HTTP `Range` header.

## Agent safety contract

`GET /api/agent/actions` publishes the current tool catalog.
`POST /api/agent/actions` executes one allow-listed tool. Read-only tools execute
immediately; state-changing tools return `428 Precondition Required` and an
exact `proposal` until the caller resubmits with `confirmed: true`. Event
deletion, billing, tunnel creation and integration secrets are intentionally
absent from this agent surface.

`POST /api/agent/chat` is the conversational coordinator for the same allow-list.
It supports `provider: auto|openai|gemini`, keeps the last 20 user/assistant
messages, executes read tools, and returns write tools in `proposals`. A client
confirms one proposal by posting it back as `confirmedAction`. Supported camera
onboarding tools include `list_sites`, `scan_cameras`, and `add_camera` with
relay-side RTSP/ONVIF auto-configuration.

A browser session token (from login/signup) has full account privileges. `POST /api/settings/api-keys` can mint a separate key scoped `read` instead — the auth middleware rejects anything but GET/HEAD for it — which is the safer choice to hand an agent that only needs to observe. There is no finer-grained RBAC (per-endpoint or per-site) yet, so for a `full` key:

- default agents to GET operations;
- require explicit human confirmation before `DELETE /api/sites/{id}`, billing, integration-secret changes, or creating tunnels/sites;
- read the target first and echo its ID/name before a destructive request;
- never retry a non-idempotent POST automatically unless the result is known;
- cap polling and use exponential backoff on `429`, `502`, and `503`;
- do not call internal relay/maintenance endpoints with a customer token.

Custom OpenAPI extensions `x-agent-risk` and `x-internal` make these rules discoverable to tools.

## Errors and compatibility

Errors use `{ "error": "message" }`. Common statuses are `400`, `401`, `404`, `409`, `429`, `502`, and `503`. Event pages use opaque cursors with `limit` defaulting to 20 and capped at 100. API versioning is not introduced; additive response fields must be tolerated. Breaking changes require a `/v2` API or a documented migration.

Internal authentication differs: relay motion uses `x-relay-secret`; maintenance and the patrol digest (`/api/internal/patrol`) both use `MAINTENANCE_SECRET`; Stripe webhook verifies `Stripe-Signature`. These secrets are platform/site credentials, not customer API tokens.

## Camera patrol digest

`POST /api/internal/patrol` (internal, `MAINTENANCE_SECRET`, called by `.github/workflows/camera-patrol.yml` on a cron) summarizes recent events for every account with at least one site and writes one consolidated report into that account's AI agent chat (`agent_messages`, `source: "patrol"`) — the proactive counterpart to the real-time per-detection alert `/api/motion` already sends. Body: `{ "mode": "activity" | "daily", "windowMinutes"?: number }`. `activity` (hourly by default) only writes a message when something happened in the window; `daily` (once a day by default) always writes one, including "no events" check-ins. Window defaults come from `PATROL_WINDOW_MINUTES` (65) and `PATROL_DAILY_WINDOW_MINUTES` (1440). Uses the same AI agent as `/api/agent/query` (BYOK OpenAI/Gemini, falls back to the platform key) to write the Vietnamese summary; without a working provider it falls back to a raw event list rather than skipping.

## Agent chat history

`/api/agent/chat` used to be entirely stateless (the client resent its own message array each call). Every turn — the homeowner's own questions, confirmed actions, and the scheduled patrol digest above — is now also persisted server-side in `agent_messages`. `GET /api/agent/chat?limit=&since=` returns `{ messages: [{ id, role, source, content, created_at }, ...] }` ordered oldest→newest; `since` (a message `id`) returns only newer rows, for polling. `POST /api/agent/chat` is unchanged in shape and still expects the client to send its own recent message window for LLM context — persistence is additive, not a replacement for that.
