-- Denormalized latest score per player.
-- Written on every score_snapshots INSERT/UPDATE via application-level upsert
-- so that portfolio and market queries never need a lateral subquery to find
-- the current price.
CREATE TABLE IF NOT EXISTS player_latest_scores (
  player_id    INTEGER PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
  score        INTEGER,
  recorded_at  TIMESTAMPTZ NOT NULL,
  source       TEXT NOT NULL DEFAULT 'snapshot',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill from existing score_snapshots so the table is accurate immediately.
INSERT INTO player_latest_scores (player_id, score, recorded_at, source, updated_at)
SELECT DISTINCT ON (player_id)
  player_id,
  score,
  COALESCE(game_ended_at, recorded_at) AS recorded_at,
  source,
  NOW()
FROM score_snapshots
ORDER BY player_id, COALESCE(game_ended_at, recorded_at) DESC
ON CONFLICT (player_id) DO UPDATE
  SET score       = EXCLUDED.score,
      recorded_at = EXCLUDED.recorded_at,
      source      = EXCLUDED.source,
      updated_at  = NOW();
