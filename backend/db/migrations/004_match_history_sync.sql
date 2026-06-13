ALTER TABLE score_snapshots
  ADD COLUMN IF NOT EXISTS match_id TEXT,
  ADD COLUMN IF NOT EXISTS game_ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'snapshot',
  ADD COLUMN IF NOT EXISTS won BOOLEAN,
  ADD COLUMN IF NOT EXISTS champion_name TEXT,
  ADD COLUMN IF NOT EXISTS queue_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'score_snapshots_source_check'
  ) THEN
    ALTER TABLE score_snapshots
      ADD CONSTRAINT score_snapshots_source_check
      CHECK (source IN ('snapshot', 'confirmed', 'estimated'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_snapshots_player_match_unique
  ON score_snapshots (player_id, match_id)
  WHERE match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_score_snapshots_player_game_ended
  ON score_snapshots (player_id, game_ended_at DESC)
  WHERE game_ended_at IS NOT NULL;
