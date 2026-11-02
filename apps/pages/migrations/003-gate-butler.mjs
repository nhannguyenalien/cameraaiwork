// "Quản gia cổng": per-camera high-security voice guard (see _lib/gateVoice.js).
export const statements = [
  "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS security_level TEXT NOT NULL DEFAULT 'normal'",
  'ALTER TABLE cameras ADD COLUMN IF NOT EXISTS voice_key_enc TEXT',
  'ALTER TABLE cameras ADD COLUMN IF NOT EXISTS voice_greeting_audio TEXT',
  `CREATE TABLE IF NOT EXISTS gate_visits (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    camera_id TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    turns INTEGER NOT NULL DEFAULT 0,
    needs_human BOOLEAN NOT NULL DEFAULT false,
    transcript TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'open'
  )`,
  'CREATE INDEX IF NOT EXISTS idx_gate_visits_account ON gate_visits(account_id, started_at DESC)',
];
