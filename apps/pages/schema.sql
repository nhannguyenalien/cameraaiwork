-- PostgreSQL schema for Neon.
--
-- Multi-tenant model: every site/camera/event belongs to an account.
-- Each account authenticates via its own API key (see scripts/generate-api-key.js).
--
-- IMPORTANT: `sites.id`, `cameras.id`, and `jobs.id` must be globally unique
-- across ALL accounts (sites/cameras are looked up without an account
-- filter on the /api/motion webhook path, since the relay authenticates
-- via its own per-site secret, not a customer API key) — random opaque ids
-- are enough for that, no need to embed the account id in the string.
--
-- IMPORTANT: never use ":" in these ids. They get used as URL path
-- segments (PATCH /api/sites/:id, /api/cameras/:site/:camera/ptz,
-- GET /api/jobs/:id) and Cloudflare Pages Functions' router mis-routes
-- segments containing a colon. Use "-" instead (see functions/api/sites/index.js
-- for the generator). This was a real bug caught during Phase 1 testing —
-- don't reintroduce it.

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,               -- e.g. "acct_abc123"
    name TEXT,
    email TEXT,                        -- set for accounts created via Google Sign-In
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    plan TEXT DEFAULT 'free',
    subscription_status TEXT DEFAULT 'inactive',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    video_retention_days INTEGER NOT NULL DEFAULT 7,
    clip_duration_seconds INTEGER
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS video_retention_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS clip_duration_seconds INTEGER;
-- SQLite can't add a UNIQUE column via ALTER TABLE, so uniqueness is a
-- separate index instead (NULLs don't collide, so accounts without an
-- email — e.g. seeded manually — are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

CREATE TABLE IF NOT EXISTS auth_credentials (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
-- The PBKDF2 iteration count used when password_hash was computed. Existing
-- rows predate this column and were hashed with the original 100,000-round
-- constant; new/changed passwords use a lower count that fits the Workers
-- free-tier CPU budget more reliably (see functions/_lib/auth.js).
ALTER TABLE auth_credentials ADD COLUMN IF NOT EXISTS password_iterations INTEGER NOT NULL DEFAULT 100000;

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,               -- SHA-256 hash of the key, never the raw key
    account_id TEXT NOT NULL REFERENCES accounts(id),
    label TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
-- Legacy browser tokens were created without a TTL. Bound their lifetime during migration.
UPDATE api_keys
SET expires_at = created_at + INTERVAL '12 hours'
WHERE expires_at IS NULL AND label LIKE 'web %';
-- 'full' = every endpoint (same as a browser session). 'read' = GET requests
-- only, enforced in functions/_middleware.js. Rows with label LIKE 'web %'
-- are browser session tokens from _lib/auth.js, always 'full' — account
-- holders manage their own keys via functions/api/settings/api-keys.js,
-- which excludes those rows from the list/revoke surface.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full' CHECK (scope IN ('full', 'read'));
CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    id TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_started TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    blocked_until TIMESTAMPTZ
);

-- Short-lived, single-use credentials generated from the authenticated
-- dashboard. They let a VPS join the correct account without copying the
-- user's long-lived login session key into shell history.
CREATE TABLE IF NOT EXISTS install_tokens (
    id TEXT PRIMARY KEY,               -- SHA-256 of the raw token
    account_id TEXT NOT NULL REFERENCES accounts(id),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_install_tokens_account ON install_tokens(account_id);

CREATE TABLE IF NOT EXISTS account_integrations (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    provider TEXT NOT NULL,
    encrypted_config TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, provider)
);

CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,               -- e.g. "st-7789da83f1a2", see note above
    account_id TEXT NOT NULL REFERENCES accounts(id),
    name TEXT,
    go2rtc_url TEXT NOT NULL,          -- this site's go2rtc, via its Cloudflare Tunnel
    relay_url TEXT NOT NULL,           -- this site's relay, via its Cloudflare Tunnel
    ai_worker_url TEXT,                -- optional local AI worker via the same tunnel
    relay_secret TEXT NOT NULL,        -- shared secret this site's relay authenticates with
    cloudflare_tunnel_id TEXT          -- lets us re-fetch the tunnel token later without storing it
);

CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,               -- e.g. "cam-4f2e9b1c0a3d"
    site_id TEXT NOT NULL REFERENCES sites(id),
    account_id TEXT NOT NULL REFERENCES accounts(id), -- denormalized for fast scoping
    stream TEXT NOT NULL,              -- go2rtc stream name at that site
    name TEXT,
    record_on_person INTEGER NOT NULL DEFAULT 1, -- upload an R2 clip for person events
    clip_duration_seconds INTEGER
);
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS clip_duration_seconds INTEGER NOT NULL DEFAULT 10;
ALTER TABLE cameras ALTER COLUMN clip_duration_seconds DROP NOT NULL;
ALTER TABLE cameras ALTER COLUMN clip_duration_seconds DROP DEFAULT;

-- One row per distinct face the system has clustered together — not
-- necessarily named yet ("Người lạ #3" until the account owner labels
-- it). ai/worker extracts a 512-dim ArcFace-style embedding per detected
-- face; functions/api/motion.js compares it (cosine similarity) against
-- every existing person for that account and either attaches the event
-- to the closest match above SIMILARITY_THRESHOLD, or creates a new row
-- here. See functions/_lib/faceMatch.js.
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,               -- e.g. "person-4f2e9b1c0a3d"
    account_id TEXT NOT NULL REFERENCES accounts(id),
    label TEXT,                        -- nullable until named, e.g. "Bố"
    embedding TEXT NOT NULL,           -- JSON array of 512 floats
    first_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    seen_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    account_id TEXT NOT NULL,
    site_id TEXT,
    camera TEXT,
    person_id TEXT REFERENCES people(id),  -- NULL if no face was matched (e.g. AI worker not deployed yet)
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    type TEXT,
    video_link TEXT,
    image_key TEXT,                    -- object key of snapshot captured when AI confirmed the person
    video_key TEXT,                    -- object key of the motion clip
    storage_backend TEXT NOT NULL DEFAULT 'r2', -- r2, customer-managed s3, or Google Drive
    video_status TEXT DEFAULT 'disabled', -- disabled, recording, ready, or error
    video_error TEXT,                  -- user-visible reason when video_status=error
    face_scan_status TEXT DEFAULT 'pending', -- pending, processing, completed, or error
    face_scan_started_at TIMESTAMPTZ,
    face_scanned_at TIMESTAMPTZ,
    face_scan_error TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    note TEXT
);

-- Idempotent upgrade for databases created before background R2 face scans.
ALTER TABLE events ADD COLUMN IF NOT EXISTS face_scan_status TEXT DEFAULT 'pending';
ALTER TABLE events ADD COLUMN IF NOT EXISTS face_scan_started_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS face_scanned_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS face_scan_error TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'r2';
ALTER TABLE events ADD COLUMN IF NOT EXISTS acknowledged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS note TEXT;

-- A motion snapshot can contain several faces. Keep this many-to-many link
-- while events.person_id remains the backwards-compatible primary face.
CREATE TABLE IF NOT EXISTS event_people (
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id),
    face_box TEXT,
    PRIMARY KEY (event_id, person_id)
);

ALTER TABLE event_people ADD COLUMN IF NOT EXISTS face_box TEXT;

-- Premium/GPU face results intentionally live beside (not on top of) the
-- local results. This lets an administrator compare both pipelines and
-- discard/rebuild the experimental GPU grouping without touching local data.
CREATE TABLE IF NOT EXISTS gpu_people (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    label TEXT,
    embedding TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    seen_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS event_gpu_people (
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES gpu_people(id),
    face_box TEXT,
    PRIMARY KEY (event_id, person_id)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS gpu_face_scan_status TEXT DEFAULT 'pending';
ALTER TABLE events ADD COLUMN IF NOT EXISTS gpu_face_scan_started_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS gpu_face_scanned_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS gpu_face_scan_error TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS gpu_face_scan_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS gpu_face_enabled INTEGER NOT NULL DEFAULT 0;

-- Singleton lease for the scheduled GPU worker. The lease expires after a
-- crash, so cron invocations never fan out or permanently wedge the queue.
CREATE TABLE IF NOT EXISTS gpu_worker_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    locked_until TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO gpu_worker_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,               -- "runpod-<runpod_job_id>" — provider-prefixed, "-" not ":"
    account_id TEXT NOT NULL REFERENCES accounts(id),
    type TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Persisted transcript of the AI agent conversation. /api/agent/chat used to
-- be entirely stateless (the client resent its own message array each
-- call); this table is what lets the dashboard show history across page
-- reloads, and is where the scheduled patrol digest
-- (functions/api/internal/patrol.js) now lands instead of Telegram.
CREATE TABLE IF NOT EXISTS agent_messages (
    id BIGSERIAL PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'chat', -- 'chat' (typed live) or 'patrol' (scheduled digest)
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_account ON agent_messages(account_id, id);

CREATE INDEX IF NOT EXISTS idx_events_account_time ON events(account_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cameras_account ON cameras(account_id);
CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_people_account ON people(account_id);
CREATE INDEX IF NOT EXISTS idx_event_people_person ON event_people(person_id, event_id DESC);
CREATE INDEX IF NOT EXISTS idx_events_face_scan ON events(site_id, face_scan_status, timestamp);
CREATE INDEX IF NOT EXISTS idx_gpu_people_account ON gpu_people(account_id);
CREATE INDEX IF NOT EXISTS idx_event_gpu_people_person ON event_gpu_people(person_id, event_id DESC);
CREATE INDEX IF NOT EXISTS idx_events_gpu_face_scan ON events(site_id, gpu_face_scan_status, timestamp);

-- Migrating an existing DB that predates the `email` column:
--   ALTER TABLE accounts ADD COLUMN email TEXT;
--   CREATE UNIQUE INDEX idx_accounts_email ON accounts(email);
-- Migrating an existing DB that predates the `cloudflare_tunnel_id` column:
--   ALTER TABLE sites ADD COLUMN cloudflare_tunnel_id TEXT;
-- Migrating an existing DB that predates the per-site AI URL:
--   ALTER TABLE sites ADD COLUMN ai_worker_url TEXT;
-- Migrating an existing DB that predates `people`/`events.person_id`:
--   CREATE TABLE people (...); -- see above
--   ALTER TABLE events ADD COLUMN person_id TEXT REFERENCES people(id);
--   CREATE TABLE event_people (event_id INTEGER NOT NULL REFERENCES events(id), person_id TEXT NOT NULL REFERENCES people(id), PRIMARY KEY (event_id, person_id));
--   CREATE INDEX idx_event_people_person ON event_people(person_id, event_id DESC);
-- Migrating an existing DB that predates `events.video_key`:
--   ALTER TABLE events ADD COLUMN video_key TEXT;
--   ALTER TABLE events ADD COLUMN image_key TEXT;
--   ALTER TABLE events ADD COLUMN video_status TEXT DEFAULT 'disabled';
--   ALTER TABLE events ADD COLUMN video_error TEXT;

-- Normally you don't hand-write these inserts at all — POST /api/sites and
-- POST /api/sites/:id/cameras (called by apps/relay/install.sh) do this for
-- you, with correctly-generated ids. Manual example, if ever needed:
-- INSERT INTO accounts (id, name) VALUES ('acct_owner', 'Chủ hệ thống');
-- INSERT INTO sites (id, account_id, name, go2rtc_url, relay_url, relay_secret)
--   VALUES ('st-nhachinh01', 'acct_owner', 'Nhà chính', '', '', 'a-long-random-string');
-- INSERT INTO cameras (id, site_id, account_id, stream, name)
--   VALUES ('cam-tapo01', 'st-nhachinh01', 'acct_owner', 'tapo', 'Camera chính');
-- Then run scripts/generate-api-key.js to create acct_owner's API key.
