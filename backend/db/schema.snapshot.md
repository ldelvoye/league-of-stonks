# Database schema snapshot

This reference reflects the `public` schema after all migrations have been applied.

## Tables

### `app_meta`

- `meta_key` `text` (NOT NULL)
- `meta_value` `text` (NOT NULL)
- `updated_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `app_meta_pkey`: PRIMARY KEY (meta_key)

Indexes:
- _None_

### `email_verification_tokens`

- `token_id` `integer` (NOT NULL, DEFAULT nextval('email_verification_tokens_token_id_seq'::regclass))
- `user_id` `integer` (NOT NULL)
- `token_hash` `text` (NOT NULL)
- `expires_at` `timestamp with time zone` (NOT NULL)
- `used_at` `timestamp with time zone`
- `created_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `email_verification_tokens_pkey`: PRIMARY KEY (token_id)
- `email_verification_tokens_token_hash_key`: UNIQUE (token_hash)
- `email_verification_tokens_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE

Indexes:
- `idx_email_verification_tokens_expires_at`: CREATE INDEX idx_email_verification_tokens_expires_at ON public.email_verification_tokens USING btree (expires_at)
- `idx_email_verification_tokens_token_hash`: CREATE INDEX idx_email_verification_tokens_token_hash ON public.email_verification_tokens USING btree (token_hash)
- `idx_email_verification_tokens_used_at`: CREATE INDEX idx_email_verification_tokens_used_at ON public.email_verification_tokens USING btree (used_at)
- `idx_email_verification_tokens_user_id`: CREATE INDEX idx_email_verification_tokens_user_id ON public.email_verification_tokens USING btree (user_id)

### `leaderboard_rollup`

- `player_id` `integer` (NOT NULL)
- `game_name` `text` (NOT NULL)
- `tag_line` `text` (NOT NULL)
- `current_score` `integer` (NOT NULL)
- `baseline_score` `integer` (NOT NULL)
- `delta_lp` `integer` (NOT NULL)
- `delta_pct` `numeric(10,2)`
- `window_days` `integer` (NOT NULL, DEFAULT 30)
- `computed_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `leaderboard_rollup_pkey`: PRIMARY KEY (player_id)
- `leaderboard_rollup_player_id_fkey`: FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE

Indexes:
- _None_

### `password_reset_tokens`

- `token_id` `integer` (NOT NULL, DEFAULT nextval('password_reset_tokens_token_id_seq'::regclass))
- `user_id` `integer` (NOT NULL)
- `token_hash` `text` (NOT NULL)
- `expires_at` `timestamp with time zone` (NOT NULL)
- `used_at` `timestamp with time zone`
- `created_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `password_reset_tokens_pkey`: PRIMARY KEY (token_id)
- `password_reset_tokens_token_hash_key`: UNIQUE (token_hash)
- `password_reset_tokens_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE

Indexes:
- `idx_password_reset_tokens_expires_at`: CREATE INDEX idx_password_reset_tokens_expires_at ON public.password_reset_tokens USING btree (expires_at)
- `idx_password_reset_tokens_token_hash`: CREATE INDEX idx_password_reset_tokens_token_hash ON public.password_reset_tokens USING btree (token_hash)
- `idx_password_reset_tokens_used_at`: CREATE INDEX idx_password_reset_tokens_used_at ON public.password_reset_tokens USING btree (used_at)
- `idx_password_reset_tokens_user_id`: CREATE INDEX idx_password_reset_tokens_user_id ON public.password_reset_tokens USING btree (user_id)

### `player_latest_scores`

- `player_id` `integer` (NOT NULL)
- `score` `integer`
- `recorded_at` `timestamp with time zone` (NOT NULL)
- `source` `text` (NOT NULL, DEFAULT 'snapshot'::text)
- `updated_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `player_latest_scores_pkey`: PRIMARY KEY (player_id)
- `player_latest_scores_player_id_fkey`: FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE

Indexes:
- _None_

### `players`

- `player_id` `integer` (NOT NULL, DEFAULT nextval('players_player_id_seq'::regclass))
- `game_name` `text` (NOT NULL)
- `tag_line` `text` (NOT NULL)
- `puuid` `text` (NOT NULL)
- `platform` `text` (NOT NULL)
- `created_at` `timestamp with time zone` (NOT NULL, DEFAULT now())
- `updated_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `players_pkey`: PRIMARY KEY (player_id)

Indexes:
- `idx_players_lookup_ci`: CREATE INDEX idx_players_lookup_ci ON public.players USING btree (lower(game_name), lower(tag_line), platform)
- `idx_players_puuid`: CREATE INDEX idx_players_puuid ON public.players USING btree (puuid)
- `idx_players_riot_id_platform`: CREATE UNIQUE INDEX idx_players_riot_id_platform ON public.players USING btree (game_name, tag_line, platform)

### `portfolio_positions`

- `position_id` `integer` (NOT NULL, DEFAULT nextval('portfolio_positions_position_id_seq'::regclass))
- `portfolio_id` `integer` (NOT NULL)
- `player_id` `integer` (NOT NULL)
- `shares` `numeric(18,3)` (NOT NULL, DEFAULT 0)
- `avg_cost` `numeric(18,2)` (NOT NULL, DEFAULT 0)
- `created_at` `timestamp with time zone` (NOT NULL, DEFAULT now())
- `updated_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `portfolio_positions_pkey`: PRIMARY KEY (position_id)
- `portfolio_positions_player_id_fkey`: FOREIGN KEY (player_id) REFERENCES players(player_id)
- `portfolio_positions_portfolio_id_fkey`: FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE
- `portfolio_positions_portfolio_id_player_id_key`: UNIQUE (portfolio_id, player_id)

Indexes:
- `idx_positions_portfolio_id`: CREATE INDEX idx_positions_portfolio_id ON public.portfolio_positions USING btree (portfolio_id)

### `portfolio_trades`

- `trade_id` `integer` (NOT NULL, DEFAULT nextval('portfolio_trades_trade_id_seq'::regclass))
- `portfolio_id` `integer` (NOT NULL)
- `player_id` `integer` (NOT NULL)
- `side` `text` (NOT NULL)
- `shares` `numeric(18,3)` (NOT NULL)
- `price_per_share` `numeric(18,2)` (NOT NULL)
- `total_value` `numeric(18,2)` (NOT NULL)
- `executed_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `portfolio_trades_pkey`: PRIMARY KEY (trade_id)
- `portfolio_trades_player_id_fkey`: FOREIGN KEY (player_id) REFERENCES players(player_id)
- `portfolio_trades_portfolio_id_fkey`: FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE
- `portfolio_trades_side_check`: CHECK (side = ANY (ARRAY['buy'::text, 'sell'::text]))

Indexes:
- `idx_trades_executed_at_desc`: CREATE INDEX idx_trades_executed_at_desc ON public.portfolio_trades USING btree (executed_at DESC, trade_id DESC)
- `idx_trades_executed_at_filter`: CREATE INDEX idx_trades_executed_at_filter ON public.portfolio_trades USING btree (executed_at)
- `idx_trades_player_id`: CREATE INDEX idx_trades_player_id ON public.portfolio_trades USING btree (player_id)
- `idx_trades_portfolio_id`: CREATE INDEX idx_trades_portfolio_id ON public.portfolio_trades USING btree (portfolio_id)

### `portfolios`

- `portfolio_id` `integer` (NOT NULL, DEFAULT nextval('portfolios_portfolio_id_seq'::regclass))
- `user_id` `integer` (NOT NULL)
- `lp_balance` `numeric(18,2)` (NOT NULL, DEFAULT 50000.00)
- `created_at` `timestamp with time zone` (NOT NULL, DEFAULT now())
- `updated_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `portfolios_pkey`: PRIMARY KEY (portfolio_id)
- `portfolios_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
- `portfolios_user_id_key`: UNIQUE (user_id)

Indexes:
- _None_

### `schema_migrations`

- `version` `text` (NOT NULL)
- `filename` `text` (NOT NULL)
- `applied_at` `timestamp with time zone` (NOT NULL, DEFAULT now())

Constraints:
- `schema_migrations_filename_key`: UNIQUE (filename)
- `schema_migrations_pkey`: PRIMARY KEY (version)

Indexes:
- _None_

### `score_snapshots`

- `id` `integer` (NOT NULL, DEFAULT nextval('score_snapshots_id_seq'::regclass))
- `player_id` `integer` (NOT NULL)
- `score` `integer`
- `recorded_at` `timestamp with time zone` (NOT NULL, DEFAULT now())
- `match_id` `text`
- `game_ended_at` `timestamp with time zone`
- `source` `text` (NOT NULL, DEFAULT 'snapshot'::text)
- `won` `boolean`
- `champion_name` `text`
- `queue_id` `integer`

Constraints:
- `score_snapshots_pkey`: PRIMARY KEY (id)
- `score_snapshots_player_id_fkey`: FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE
- `score_snapshots_source_check`: CHECK (source = ANY (ARRAY['snapshot'::text, 'confirmed'::text, 'estimated'::text]))

Indexes:
- `idx_score_snapshots_player_confirmed_effective`: CREATE INDEX idx_score_snapshots_player_confirmed_effective ON public.score_snapshots USING btree (player_id, COALESCE(game_ended_at, recorded_at) DESC) WHERE ((source = 'confirmed'::text) AND (match_id IS NOT NULL))
- `idx_score_snapshots_player_effective`: CREATE INDEX idx_score_snapshots_player_effective ON public.score_snapshots USING btree (player_id, COALESCE(game_ended_at, recorded_at) DESC)
- `idx_score_snapshots_player_game_ended`: CREATE INDEX idx_score_snapshots_player_game_ended ON public.score_snapshots USING btree (player_id, game_ended_at DESC) WHERE (game_ended_at IS NOT NULL)
- `idx_score_snapshots_player_match_unique`: CREATE UNIQUE INDEX idx_score_snapshots_player_match_unique ON public.score_snapshots USING btree (player_id, match_id) WHERE (match_id IS NOT NULL)
- `idx_score_snapshots_player_recorded`: CREATE INDEX idx_score_snapshots_player_recorded ON public.score_snapshots USING btree (player_id, recorded_at DESC)
- `idx_score_snapshots_player_recorded_asc`: CREATE INDEX idx_score_snapshots_player_recorded_asc ON public.score_snapshots USING btree (player_id, recorded_at) WHERE (score IS NOT NULL)

### `sessions`

- `session_id` `integer` (NOT NULL, DEFAULT nextval('sessions_session_id_seq'::regclass))
- `user_id` `integer` (NOT NULL)
- `token_hash` `text` (NOT NULL)
- `expires_at` `timestamp with time zone` (NOT NULL)
- `created_at` `timestamp with time zone` (NOT NULL, DEFAULT now())
- `revoked_at` `timestamp with time zone`

Constraints:
- `sessions_pkey`: PRIMARY KEY (session_id)
- `sessions_token_hash_key`: UNIQUE (token_hash)
- `sessions_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE

Indexes:
- `idx_sessions_expires_at`: CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at)
- `idx_sessions_revoked_at`: CREATE INDEX idx_sessions_revoked_at ON public.sessions USING btree (revoked_at)
- `idx_sessions_token_hash`: CREATE INDEX idx_sessions_token_hash ON public.sessions USING btree (token_hash)
- `idx_sessions_user_id`: CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id)

### `users`

- `user_id` `integer` (NOT NULL, DEFAULT nextval('users_user_id_seq'::regclass))
- `email` `text` (NOT NULL)
- `password_hash` `text` (NOT NULL)
- `email_verified_at` `timestamp with time zone`
- `created_at` `timestamp with time zone` (NOT NULL, DEFAULT now())
- `updated_at` `timestamp with time zone` (NOT NULL, DEFAULT now())
- `username` `text` (NOT NULL)
- `pending_email` `text`
- `username_changed_at` `timestamp with time zone`
- `email_change_requested_at` `timestamp with time zone`

Constraints:
- `users_pkey`: PRIMARY KEY (user_id)

Indexes:
- `idx_users_email`: CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (lower(email))
- `idx_users_email_change_requested_at`: CREATE INDEX idx_users_email_change_requested_at ON public.users USING btree (email_change_requested_at)
- `idx_users_pending_email`: CREATE UNIQUE INDEX idx_users_pending_email ON public.users USING btree (lower(pending_email)) WHERE (pending_email IS NOT NULL)
- `idx_users_username`: CREATE UNIQUE INDEX idx_users_username ON public.users USING btree (lower(username))
- `idx_users_username_changed_at`: CREATE INDEX idx_users_username_changed_at ON public.users USING btree (username_changed_at)
