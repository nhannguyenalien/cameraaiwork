export const statements = [
  'ALTER TABLE events ADD COLUMN IF NOT EXISTS source_event_id TEXT',
  'ALTER TABLE events ADD COLUMN IF NOT EXISTS relay_sync_complete BOOLEAN NOT NULL DEFAULT false',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_events_relay_source ON events(site_id, source_event_id)',
];
