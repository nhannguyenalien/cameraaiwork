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
| Account | `GET /api/settings/account` |
| Sites | `GET/POST /api/sites`, `DELETE /api/sites/{id}` |
| Cameras | `GET /api/cameras`, `POST /api/sites/{id}/cameras` |
| Control | `POST /api/cameras/{site}/{camera}/live`, `/ptz` |
| Events/people | `GET /api/events`, `/events/{id}/video`, `/people`; `PATCH /api/people/{id}` |
| Integrations/jobs | `GET/PUT/DELETE /api/settings/integrations`, `POST /api/jobs`, `GET /api/jobs/{id}` |
| Billing | `POST /api/billing/checkout`, `/portal` |
| Operations | `GET /api/health`; internal `/api/motion`, `/api/internal/maintenance` |

See OpenAPI for bodies, response schemas, operation IDs and examples.

## Streaming and PTZ

`POST /api/cameras/{site}/{camera}/live` returns a five-minute signed capability URL plus `expiresAt` and `viewerLimit`. Request a new URL shortly before expiry; do not persist or share it. Relay enforcement is currently Free: 1 and Pro: 5 concurrent viewers per camera.

```bash
curl -fsS -X POST "$CAMERAAI_API/api/cameras/st-example/cam1/live" \
  -H "Authorization: Bearer $CAMERAAI_TOKEN"

curl -fsS -X POST "$CAMERAAI_API/api/cameras/st-example/cam1/ptz" \
  -H "Authorization: Bearer $CAMERAAI_TOKEN" \
  -H 'Content-Type: application/json' --data '{"direction":"left"}'
```

PTZ accepts `up`, `down`, `left`, `right`, or `stop`. Always send `stop` after a movement command.

## Agent safety contract

The current bearer token has full account privileges; scoped agent keys/RBAC are not implemented yet. Until they are:

- default agents to GET operations;
- require explicit human confirmation before `DELETE /api/sites/{id}`, billing, integration-secret changes, or creating tunnels/sites;
- read the target first and echo its ID/name before a destructive request;
- never retry a non-idempotent POST automatically unless the result is known;
- cap polling and use exponential backoff on `429`, `502`, and `503`;
- do not call internal relay/maintenance endpoints with a customer token.

Custom OpenAPI extensions `x-agent-risk` and `x-internal` make these rules discoverable to tools.

## Errors and compatibility

Errors use `{ "error": "message" }`. Common statuses are `400`, `401`, `404`, `409`, `429`, `502`, and `503`. There is no pagination cursor yet: events use `limit` (default 20, maximum 100). API versioning is not introduced; additive response fields must be tolerated. Breaking changes require a `/v2` API or a documented migration.

Internal authentication differs: relay motion uses `x-relay-secret`; maintenance uses `MAINTENANCE_SECRET`; Stripe webhook verifies `Stripe-Signature`. These secrets are platform/site credentials, not customer API tokens.
