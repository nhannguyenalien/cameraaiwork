# Database transfer rollout and 24-hour measurement

Apply the database migration **before** publishing Pages or GPU worker:

```sh
node --env-file=apps/pages/.dev.vars scripts/migrate-network-transfer.mjs
```

Uses a transaction; rerunning is safe. Requires CREATE EXTENSION permission for pgvector. Generated vectors preserve the existing text embeddings and remain compatible with the previous application. Allow a maintenance window: adding stored generated columns rewrites both people tables. Matching is exact cosine search, scoped to account and model, with an advisory transaction lock around match/create. This reduces transferred data, but still scans vectors on the database. Evaluate fixed-dimension HNSW indexes with real account sizes and recall tests if database CPU becomes a bottleneck.

Do not publish dependent code while Neon rejects requests for exhausted quota. Restore project access through the provider (quota reset or an explicitly approved paid change), apply migration, then publish both services. A code fix cannot reset consumed quota. Keep the schema when rolling application code back.

Dashboard events request `page`, `limit`, `delta=1`, and `known` (JSON map of visible IDs to versions). The response contains `rows` (new/changed visible events), `manifest` (ordered visible IDs/versions), and `total`. This detects deletions, renames, and late video updates. It still transfers a small manifest and count on each poll. Polling is 15 seconds and pauses when the document is hidden.

People requests accept `page` (default 1), `limit` (default 12, maximum 100), `filter=all|named|unnamed`, `search`, and `source=local|gpu`. Response remains an array with `X-Total-Count`, `X-Unnamed-Count`, `X-Filtered-Count` headers. External clients must paginate; the repository's mobile client follows pages to preserve its existing person selector. Dashboard only fetches its visible people page.

Local and GPU embeddings come from different models and must not be mixed. GPU remains opt-in; enabling it intentionally runs a second recognition model on the same event. Existing queue claims prevent simultaneous GPU jobs; completed local backfills now return existing links on sequential retries. This is not a guarantee of exactly-once delivery during simultaneous POST retries or crashes.

## Measurement procedure

1. Record Neon project's network-transfer usage and the measurement start time. Record camera count, AI interval, motion rate, GPU enabled/disabled, and number of dashboard viewers. Include an idle period to identify polling overhead.
2. Capture structured logs from **both** the deployed Pages Functions and GPU worker using Wrangler tail with JSON output (or durable Cloudflare log export). `db_transfer` records include a flow, query fingerprint, result byte estimate, duration and success. No SQL text, parameters, embeddings or row values are logged. `DB_METRICS=0` disables instrumentation. Keep logs private.
3. Run the cameras for a full 24 hours with representative motion, lighting and dashboard usage. Tail sessions can disconnect or be sampled: reconnecting does not recover lost logs. Use durable export for a reliable complete capture. Convert capture to one JSON object per line (NDJSON) if the tail tool pretty-prints objects.
4. Record Neon usage again, allowing its usage dashboard to catch up. The difference in the provider's counter is the authoritative billed transfer. Application estimates exclude wire overhead, provider accounting differences, and missing/sampled logs. They measure database result payloads, not camera media in R2/S3/Drive, RunPod traffic or browser downloads.
5. Aggregate complete logs:

```sh
node scripts/report-db-transfer.mjs --hours 24 --cameras 1 --target-cameras 10 < capture.ndjson
```

6. Estimate transfer at target load: measured billed GB / camera-hours × target cameras × 24 × 30. Treat this as a scenario, not a capacity promise: dashboard users, motion frequency, retained people and idle polling may not scale linearly. Use the provider's current plan quota and overage rate to calculate cost; add storage, media egress, GPU and compute separately. Repeat a representative multi-camera test before public rollout.

A 24-hour result has not been collected merely by adding this instrumentation. Record actual start/end counters and log coverage before drawing cost conclusions.
