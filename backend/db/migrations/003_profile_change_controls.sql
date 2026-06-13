ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_change_requested_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pending_email
  ON users (LOWER(pending_email))
  WHERE pending_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_username_changed_at
  ON users (username_changed_at);
CREATE INDEX IF NOT EXISTS idx_users_email_change_requested_at
  ON users (email_change_requested_at);
