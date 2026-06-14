import { createHash, randomBytes } from "crypto";
import { getPool } from "../index.js";

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export function generatePasswordResetToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash, expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS) };
}

export async function createPasswordResetToken(
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await getPool().query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

/** Invalidates all unused reset tokens for a user, optionally keeping one token hash active. */
export async function revokePendingPasswordResetTokens(
  userId: number,
  keepTokenHash?: string,
): Promise<void> {
  if (keepTokenHash) {
    await getPool().query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL AND token_hash <> $2`,
      [userId, keepTokenHash],
    );
    return;
  }

  await getPool().query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
}

/** Invalidates a specific reset token by hash. */
export async function revokePasswordResetToken(tokenHash: string): Promise<void> {
  await getPool().query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL`,
    [tokenHash],
  );
}

/** Returns the matching reset token row only if unused and unexpired. */
export async function findPasswordResetToken(
  tokenHash: string,
): Promise<{ tokenId: number; userId: number } | null> {
  const { rows } = await getPool().query(
    `SELECT token_id, user_id
     FROM password_reset_tokens
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );
  if (!rows[0]) return null;
  return { tokenId: rows[0].token_id as number, userId: rows[0].user_id as number };
}

/** Consumes reset token, updates password hash, and revokes active sessions atomically. */
export async function consumePasswordResetToken(
  tokenId: number,
  userId: number,
  newPasswordHash: string,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE token_id = $1`,
      [tokenId],
    );
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    await client.query(
      `UPDATE users
       SET password_hash = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, newPasswordHash],
    );
    await client.query(
      `UPDATE sessions
       SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Deletes used and expired reset tokens. */
export async function purgeExpiredPasswordResetTokens(): Promise<void> {
  await getPool().query(
    `DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL`,
  );
}
