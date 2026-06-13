import { createHash, randomBytes } from "crypto";
import { getPool } from "../index.js";

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const TOKEN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateVerificationToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash, expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS) };
}

export async function createVerificationToken(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
  await getPool().query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

/** Invalidates all unused verification tokens for a user, optionally keeping one token hash active. */
export async function revokePendingVerificationTokens(
  userId: number,
  keepTokenHash?: string,
): Promise<void> {
  if (keepTokenHash) {
    await getPool().query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL AND token_hash <> $2`,
      [userId, keepTokenHash],
    );
    return;
  }

  await getPool().query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
}

/** Invalidates a specific verification token by hash. */
export async function revokeVerificationToken(tokenHash: string): Promise<void> {
  await getPool().query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL`,
    [tokenHash],
  );
}

/** Returns the matching token row only if unused and unexpired. */
export async function findVerificationToken(
  tokenHash: string,
): Promise<{ tokenId: number; userId: number } | null> {
  const { rows } = await getPool().query(
    `SELECT token_id, user_id
     FROM email_verification_tokens
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );
  if (!rows[0]) return null;
  return { tokenId: rows[0].token_id as number, userId: rows[0].user_id as number };
}

/** Marks the token used and confirms current or pending email atomically. */
export async function consumeVerificationToken(tokenId: number, userId: number): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE token_id = $1`,
      [tokenId],
    );
    await client.query(
      `UPDATE users
       SET
         email = COALESCE(pending_email, email),
         pending_email = NULL,
         email_change_requested_at = NULL,
         email_verified_at = NOW(),
         updated_at = NOW()
       WHERE user_id = $1`,
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

/** Deletes used and expired verification tokens. */
export async function purgeExpiredVerificationTokens(): Promise<void> {
  await getPool().query(
    `DELETE FROM email_verification_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL`,
  );
}

export function scheduleVerificationTokenCleanup(): void {
  purgeExpiredVerificationTokens().catch((err) =>
    console.error("Verification token cleanup failed:", err),
  );
  setInterval(() => {
    purgeExpiredVerificationTokens().catch((err) =>
      console.error("Verification token cleanup failed:", err),
    );
  }, TOKEN_CLEANUP_INTERVAL_MS).unref();
}
