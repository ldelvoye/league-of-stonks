-- Leaderboard rollup: pre-computed top-performer rows so queryTopPerformers
-- does not need to run per-player lateral scans on every request.
-- Refreshed by a scheduled job every few minutes via refreshLeaderboard().
CREATE TABLE IF NOT EXISTS leaderboard_rollup (
  player_id      INTEGER PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
  game_name      TEXT NOT NULL,
  tag_line       TEXT NOT NULL,
  current_score  INTEGER NOT NULL,
  baseline_score INTEGER NOT NULL,
  delta_lp       INTEGER NOT NULL,
  delta_pct      NUMERIC(10, 2),
  window_days    INTEGER NOT NULL DEFAULT 30,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initial backfill using the same logic as the old queryTopPerformers query.
INSERT INTO leaderboard_rollup (
  player_id, game_name, tag_line,
  current_score, baseline_score, delta_lp, delta_pct,
  window_days, computed_at
)
SELECT
  p.player_id,
  p.game_name,
  p.tag_line,
  last_snap.score  AS current_score,
  first_snap.score AS baseline_score,
  (last_snap.score - first_snap.score) AS delta_lp,
  CASE WHEN first_snap.score > 0
       THEN ROUND((last_snap.score - first_snap.score)::numeric / first_snap.score * 100, 2)
       ELSE NULL
  END AS delta_pct,
  30 AS window_days,
  NOW() AS computed_at
FROM players p
JOIN LATERAL (
  SELECT score FROM score_snapshots
  WHERE player_id = p.player_id AND score IS NOT NULL
  ORDER BY COALESCE(game_ended_at, recorded_at) DESC LIMIT 1
) last_snap ON true
JOIN LATERAL (
  SELECT score FROM score_snapshots
  WHERE player_id = p.player_id AND score IS NOT NULL
    AND recorded_at >= NOW() - INTERVAL '30 days'
  ORDER BY recorded_at ASC LIMIT 1
) first_snap ON true
WHERE (last_snap.score - first_snap.score) > 0
ON CONFLICT (player_id) DO UPDATE
  SET game_name      = EXCLUDED.game_name,
      tag_line       = EXCLUDED.tag_line,
      current_score  = EXCLUDED.current_score,
      baseline_score = EXCLUDED.baseline_score,
      delta_lp       = EXCLUDED.delta_lp,
      delta_pct      = EXCLUDED.delta_pct,
      computed_at    = NOW();
