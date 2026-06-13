CREATE INDEX IF NOT EXISTS idx_players_lookup_ci
  ON players (LOWER(game_name), LOWER(tag_line), platform);

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  suffix INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app_meta
    WHERE meta_key = 'users_username_backfill_v1'
  ) THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT user_id
    FROM users
    WHERE username IS NULL OR TRIM(username) = ''
  LOOP
    suffix := 0;
    LOOP
      candidate := CASE
        WHEN suffix = 0 THEN CONCAT('legacy_user_', rec.user_id)
        ELSE CONCAT('legacy_user_', rec.user_id, '_', suffix)
      END;

      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE LOWER(u.username) = LOWER(candidate)
          AND u.user_id <> rec.user_id
      );

      suffix := suffix + 1;
    END LOOP;

    UPDATE users
    SET username = candidate
    WHERE user_id = rec.user_id;
  END LOOP;

  INSERT INTO app_meta (meta_key, meta_value)
  VALUES ('users_username_backfill_v1', 'done')
  ON CONFLICT (meta_key) DO UPDATE
  SET
    meta_value = EXCLUDED.meta_value,
    updated_at = NOW();
END $$;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (LOWER(username));

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions (revoked_at);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at
  ON email_verification_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_used_at
  ON email_verification_tokens (used_at);
