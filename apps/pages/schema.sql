-- Run once against your Turso DB, e.g.:
--   turso db shell <db-name> < schema.sql
--
-- Multi-tenant model: every site/camera/event belongs to an account.
-- Each account authenticates via its own API key (see scripts/generate-api-key.js).
--
-- IMPORTANT: `sites.id` and `cameras.id` must be globally unique across ALL
-- accounts (they're looked up without an account filter on the /api/motion
-- webhook path, since the relay authenticates via its own per-site secret,
-- not a customer API key). Generate them prefixed with the account id, e.g.
-- "acct_abc123:nha_chinh", not just "nha_chinh".

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,               -- e.g. "acct_abc123"
    name TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,               -- SHA-256 hash of the key, never the raw key
    account_id TEXT NOT NULL REFERENCES accounts(id),
    label TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    revoked_at DATETIME
);

CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,               -- globally unique, see note above
    account_id TEXT NOT NULL REFERENCES accounts(id),
    name TEXT,
    go2rtc_url TEXT NOT NULL,          -- this site's go2rtc, via its Cloudflare Tunnel
    relay_url TEXT NOT NULL,           -- this site's relay, via its Cloudflare Tunnel
    relay_secret TEXT NOT NULL         -- shared secret this site's relay authenticates with
);

CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,               -- globally unique, e.g. "acct_abc123:nha_chinh:tapo"
    site_id TEXT NOT NULL REFERENCES sites(id),
    account_id TEXT NOT NULL REFERENCES accounts(id), -- denormalized for fast scoping
    stream TEXT NOT NULL,              -- go2rtc stream name at that site
    name TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    site_id TEXT,
    camera TEXT,
    timestamp DATETIME DEFAULT (datetime('now','localtime')),
    type TEXT,
    video_link TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,               -- "runpod:<runpod_job_id>" — provider-prefixed
    account_id TEXT NOT NULL REFERENCES accounts(id),
    type TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_account_time ON events(account_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cameras_account ON cameras(account_id);
CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);

-- Example seed for the one camera running today (single-account bootstrap):
-- INSERT INTO accounts (id, name) VALUES ('acct_owner', 'Chủ hệ thống');
-- INSERT INTO sites (id, account_id, name, go2rtc_url, relay_url, relay_secret)
--   VALUES ('acct_owner:nha_chinh', 'acct_owner', 'Nhà chính',
--           'https://go2rtc-nhachinh.yourdomain.com',
--           'https://relay-nhachinh.yourdomain.com', 'a-long-random-string');
-- INSERT INTO cameras (id, site_id, account_id, stream, name)
--   VALUES ('acct_owner:nha_chinh:tapo', 'acct_owner:nha_chinh', 'acct_owner', 'tapo', 'Camera chính');
-- Then run scripts/generate-api-key.js to create acct_owner's API key.
