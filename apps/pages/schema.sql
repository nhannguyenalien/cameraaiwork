-- Run once against your Turso DB, e.g.:
--   turso db shell <db-name> < schema.sql
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
    created_at DATETIME DEFAULT (datetime('now'))
);
-- SQLite can't add a UNIQUE column via ALTER TABLE, so uniqueness is a
-- separate index instead (NULLs don't collide, so accounts without an
-- email — e.g. seeded manually — are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,               -- SHA-256 hash of the key, never the raw key
    account_id TEXT NOT NULL REFERENCES accounts(id),
    label TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    revoked_at DATETIME
);

CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,               -- e.g. "st-7789da83f1a2", see note above
    account_id TEXT NOT NULL REFERENCES accounts(id),
    name TEXT,
    go2rtc_url TEXT NOT NULL,          -- this site's go2rtc, via its Cloudflare Tunnel
    relay_url TEXT NOT NULL,           -- this site's relay, via its Cloudflare Tunnel
    relay_secret TEXT NOT NULL,        -- shared secret this site's relay authenticates with
    cloudflare_tunnel_id TEXT          -- lets us re-fetch the tunnel token later without storing it
);

CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,               -- e.g. "cam-4f2e9b1c0a3d"
    site_id TEXT NOT NULL REFERENCES sites(id),
    account_id TEXT NOT NULL REFERENCES accounts(id), -- denormalized for fast scoping
    stream TEXT NOT NULL,              -- go2rtc stream name at that site
    name TEXT
);

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
    first_seen_at DATETIME DEFAULT (datetime('now','localtime')),
    last_seen_at DATETIME DEFAULT (datetime('now','localtime')),
    seen_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    site_id TEXT,
    camera TEXT,
    person_id TEXT REFERENCES people(id),  -- NULL if no face was matched (e.g. AI worker not deployed yet)
    timestamp DATETIME DEFAULT (datetime('now','localtime')),
    type TEXT,
    video_link TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,               -- "runpod-<runpod_job_id>" — provider-prefixed, "-" not ":"
    account_id TEXT NOT NULL REFERENCES accounts(id),
    type TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_account_time ON events(account_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cameras_account ON cameras(account_id);
CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_people_account ON people(account_id);

-- Migrating an existing DB that predates the `email` column:
--   ALTER TABLE accounts ADD COLUMN email TEXT;
--   CREATE UNIQUE INDEX idx_accounts_email ON accounts(email);
-- Migrating an existing DB that predates the `cloudflare_tunnel_id` column:
--   ALTER TABLE sites ADD COLUMN cloudflare_tunnel_id TEXT;
-- Migrating an existing DB that predates `people`/`events.person_id`:
--   CREATE TABLE people (...); -- see above
--   ALTER TABLE events ADD COLUMN person_id TEXT REFERENCES people(id);

-- Normally you don't hand-write these inserts at all — POST /api/sites and
-- POST /api/sites/:id/cameras (called by apps/relay/install.sh) do this for
-- you, with correctly-generated ids. Manual example, if ever needed:
-- INSERT INTO accounts (id, name) VALUES ('acct_owner', 'Chủ hệ thống');
-- INSERT INTO sites (id, account_id, name, go2rtc_url, relay_url, relay_secret)
--   VALUES ('st-nhachinh01', 'acct_owner', 'Nhà chính', '', '', 'a-long-random-string');
-- INSERT INTO cameras (id, site_id, account_id, stream, name)
--   VALUES ('cam-tapo01', 'st-nhachinh01', 'acct_owner', 'tapo', 'Camera chính');
-- Then run scripts/generate-api-key.js to create acct_owner's API key.
