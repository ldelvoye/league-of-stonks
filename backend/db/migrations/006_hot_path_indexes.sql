-- Recent-trades feed: ORDER BY executed_at DESC, trade_id DESC
CREATE INDEX IF NOT EXISTS idx_trades_executed_at_desc
  ON portfolio_trades (executed_at DESC, trade_id DESC);

-- 24-hour volume aggregation: WHERE executed_at >= NOW() - INTERVAL '24 hours'
CREATE INDEX IF NOT EXISTS idx_trades_executed_at_filter
  ON portfolio_trades (executed_at);

-- Effective-time ordering for score history and lateral lookups.
-- Covers ORDER BY COALESCE(game_ended_at, recorded_at) DESC used in
-- getScoreHistory, getLatestConfirmedMatchId, and listPortfolioPositionsWithMarket.
CREATE INDEX IF NOT EXISTS idx_score_snapshots_player_effective
  ON score_snapshots (player_id, COALESCE(game_ended_at, recorded_at) DESC);

-- Confirmed-match lookup: WHERE source = 'confirmed' AND match_id IS NOT NULL
-- ORDER BY COALESCE(game_ended_at, recorded_at) DESC
CREATE INDEX IF NOT EXISTS idx_score_snapshots_player_confirmed_effective
  ON score_snapshots (player_id, COALESCE(game_ended_at, recorded_at) DESC)
  WHERE source = 'confirmed' AND match_id IS NOT NULL;

-- Top-performers window baseline: WHERE recorded_at >= NOW() - interval ORDER BY recorded_at ASC
-- (covers the first_snap lateral join in queryTopPerformers)
CREATE INDEX IF NOT EXISTS idx_score_snapshots_player_recorded_asc
  ON score_snapshots (player_id, recorded_at ASC)
  WHERE score IS NOT NULL;
