import { getPool } from "../index.js";

export interface Session {
  sessionId: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

const SESSION_COLUMNS =
  "session_id, user_id, token_hash, expires_at, created_at, revoked_at";

function mapSession(row: Record<string, unknown> | undefined): Session | null {
  if (!row) return null;
  return {
    sessionId: row.session_id as number,
    userId: row.user_id as number,
    tokenHash: row.token_hash as string,
    expiresAt: row.expires_at as Date,
    createdAt: row.created_at as Date,
    revokedAt: row.revoked_at as Date | null,
  };
}

export async function createSession(
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<Session> {
  const { rows } = await getPool().query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING ${SESSION_COLUMNS}`,
    [userId, tokenHash, expiresAt],
  );
  return mapSession(rows[0]) as Session;
}

/** Returns the session only if it exists, has not expired, and has not been revoked. */
export async function findSession(tokenHash: string): Promise<Session | null> {
  const { rows } = await getPool().query(
    `SELECT ${SESSION_COLUMNS}
     FROM sessions
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );
  return mapSession(rows[0]);
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await getPool().query(
    `UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  );
}

export async function revokeSessionsByUserId(userId: number): Promise<void> {
  await getPool().query(
    `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

/** Deletes expired and revoked sessions. Safe to call at any time. */
export async function purgeExpiredSessions(): Promise<void> {
  await getPool().query(
    `DELETE FROM sessions WHERE expires_at < NOW() OR revoked_at IS NOT NULL`,
  );
}
