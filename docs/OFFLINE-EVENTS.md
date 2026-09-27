# Offline event storage and synchronization

The relay saves each locally detected event to `apps/relay/data/event-outbox` before contacting the cloud. Local AI and trusted ONVIF detection continue without Internet as long as the relay, camera LAN, go2rtc and required local AI models remain available. Losing the camera LAN connection or power cannot produce new footage.

Each event has a UUID, original detection timestamp, available JPEG, and an optional MP4 captured immediately through local RTSP. This retains event clips, **not continuous 24-hour video**. Video uses the camera recording preference and plan clip duration cached from authenticated `GET /api/motion?siteId=...`, refreshed every minute. Before the first successful policy download, only metadata/photos are captured; cached policy survives a restart. Face identification is completed by the existing backfill/GPU flow after upload.

Defaults:

| Setting | Default | Behavior |
| --- | --- | --- |
| `OFFLINE_RETENTION_HOURS` | `24` | Sliding expiry from detection time, including while disconnected. |
| `OFFLINE_MAX_BYTES` | `2147483648` | 2 GiB queue limit; oldest events are removed when full, even before 24 hours. |
| `OFFLINE_UPLOAD_BYTES_PER_SECOND` | `524288` | One upload at a time, capped at 512 KiB/s. |
| `EVENT_OUTBOX_DIR` | `apps/relay/data/event-outbox` | Durable private directory; optionally use a separate disk. |

Expiration/quota cleanup runs on the sync loop, including after failed uploads and on restart. Active captures are excluded until completed, so disk use can briefly exceed the limit by the in-progress clips. Keep sufficient disk space for FFmpeg temporary files as well. Expiry and quota eviction are logged as `Offline event expired/space limit`. This is a bounded buffer, not a guarantee of retaining every event for 24 hours regardless of volume.

At most two clips are captured concurrently. Video is copied without re-encoding; audio is converted to AAC when present. Each clip is capped at 20 MiB and each JPEG at 2 MiB. A failed/oversized/overloaded capture still retains event metadata and any successful snapshot; the cloud displays a video error when recording was expected. Queue manifests and media use temporary files followed by atomic rename. A process restart preserves completed files; an interrupted clip may be unavailable.

The relay retries with increasing delays (up to one minute between attempts; individual failed events may wait up to five minutes). Each upload includes the original timestamp and UUID. The cloud deduplicates by site/UUID, stores the image and clip on the same storage backend, and acknowledges only after object storage and the event row complete. A lost response can therefore be retried without creating another event. Only an acknowledgement with the matching UUID permits early local deletion. Current cloud recording settings can disable retention of an already-captured video. Telegram notifications are best effort and sent only by the request that first finishes an event; delayed alerts show the original event time.

## Rollout

1. Apply the additive migration to the existing Neon database with `DATABASE_URL` supplied through your normal secret environment:
   ```sh
   node scripts/migrate-offline-events.mjs
   ```
   The main `scripts/migrate-db.mjs` also applies these schema additions. Both paths are idempotent.
2. Build and deploy Pages with the updated motion handler. Legacy JSON motion requests remain supported.
3. Build the relay distribution with `bash scripts/build-relay-bundle.sh`, publish the updated Pages assets, and update/restart each relay. The private default data directory is excluded from the distribution and preserved by the update script. Place any custom outbox directory outside the bundled source trees.
4. Allow one successful camera-policy sync, disconnect the relay's Internet (keep camera LAN working), trigger an event, then restore Internet. Confirm its original timestamp/media appear once in the dashboard and its local directory is removed.

Do not upgrade relay before Pages: an older cloud handler cannot acknowledge multipart events, which remain queued only until their retention/quota limit. No production database migration or deployment is performed merely by editing these files.

## Checks

```sh
node --test apps/relay/test/*.test.js apps/pages/test/*.test.mjs
npm --prefix apps/pages run build:functions
```
