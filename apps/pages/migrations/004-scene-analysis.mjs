// AI scene analysis of high-security person events (see functions/_lib/sceneAnalysis.js).
export const statements = [
  'ALTER TABLE events ADD COLUMN IF NOT EXISTS scene_json TEXT',
  'ALTER TABLE events ADD COLUMN IF NOT EXISTS threat_level SMALLINT',
  'CREATE INDEX IF NOT EXISTS idx_events_scene ON events(account_id, timestamp DESC) WHERE scene_json IS NOT NULL',
];
