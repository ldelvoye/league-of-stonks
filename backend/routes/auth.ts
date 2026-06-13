import { createHash } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getPool } from "../db/index.js";
import {
  consumeVerificationToken,
  createVerificationToken,
  findVerificationTokenRecord,
  findVerificationToken,
  generateVerificationToken,
  revokePendingVerificationTokens,
  revokeVerificationToken,
} from "../db/tables/emailVerification.js";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  findPasswordResetToken,
  generatePasswordResetToken,
  revokePasswordResetToken,
  revokePendingPasswordResetTokens,
} from "../db/tables/passwordReset.js";
import { STARTING_LP } from "../db/tables/portfolios.js";
import {
  clearPendingEmailChange,
  createUser,
  findUserByAnyEmail,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  requestEmailChange,
  updateUsername,
} from "../db/tables/users.js";
import { revokeSession, createSession } from "../db/tables/sessions.js";
import {
  clearSessionCookie,
  generateSessionToken,
  hashToken,
  hashPassword,
  requireAuth,
  setSessionCookie,
  toAuthUser,
  verifyPassword,
} from "../lib/auth.js";
import { formatRetryAfter, getProfileChangeCooldown } from "../lib/cooldown.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/email.js";

const router = Router();
const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
const REGISTER_CONFLICT_ERROR = "Email or username already in use";

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  if (!BASIC_EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!USERNAME_REGEX.test(normalized)) return null;
  return normalized;
}

function normalizeLoginIdentifier(
  value: unknown,
): { kind: "email" | "username"; value: string } | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const email = normalizeEmail(raw);
  if (email) return { kind: "email", value: email };

  const username = normalizeUsername(raw);
  if (username) return { kind: "username", value: username };

  return null;
}

function profileChangeRateLimitError(field: "Username" | "Email", retryAfterMs: number): string {
  return `${field} can only be changed once every 24 hours. Try again in ${formatRetryAfter(retryAfterMs)}.`;
}

function profileChangeStatus(field: "Username" | "Email", lastChangedAt: Date | null): {
  allowed: boolean;
  retryAfterMs: number;
  message: string | null;
} {
  const cooldown = getProfileChangeCooldown(lastChangedAt);
  if (cooldown.allowed) {
    return { allowed: true, retryAfterMs: 0, message: null };
  }
  return {
    allowed: false,
    retryAfterMs: cooldown.retryAfterMs,
    message: profileChangeRateLimitError(field, cooldown.retryAfterMs),
  };
}

// 10 attempts per 15 minutes per IP on login and register.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

// Resend verification: capped per IP and per user.
const resendIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

const resendUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
  keyGenerator: (req) => String(req.user!.userId),
});

const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
  keyGenerator: (req) => String(req.user!.userId),
});

const requestPasswordResetUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
  keyGenerator: (req) => String(req.user!.userId),
});

router.use("/login", authLimiter);
router.use("/register", authLimiter);
router.use("/resend-verification", resendIpLimiter);
router.use("/verify-email", verifyEmailLimiter);
router.use("/forgot-password", forgotPasswordLimiter);
router.use("/reset-password", resetPasswordLimiter);

export function resetAuthRateLimitsForTests(): void {
  const localLoopbackKeys = ["::1", "::ffff:127.0.0.1", "127.0.0.1"];
  const resetters = [
    authLimiter,
    resendIpLimiter,
    resendUserLimiter,
    verifyEmailLimiter,
    forgotPasswordLimiter,
    resetPasswordLimiter,
    profileUpdateLimiter,
    requestPasswordResetUserLimiter,
  ];

  for (const limiter of resetters) {
    for (const key of localLoopbackKeys) {
      limiter.resetKey(key);
    }
  }
}

async function issueVerificationEmail(userId: number, email: string): Promise<void> {
  const verification = generateVerificationToken();
  await createVerificationToken(userId, verification.hash, verification.expiresAt);
  try {
    await sendVerificationEmail(email, verification.token);
  } catch (err) {
    await revokeVerificationToken(verification.hash);
    throw err;
  }
  await revokePendingVerificationTokens(userId, verification.hash);
}

async function issuePasswordResetEmail(userId: number, email: string): Promise<void> {
  const reset = generatePasswordResetToken();
  await createPasswordResetToken(userId, reset.hash, reset.expiresAt);
  try {
    await sendPasswordResetEmail(email, reset.token);
  } catch (err) {
    await revokePasswordResetToken(reset.hash);
    throw err;
  }
  await revokePendingPasswordResetTokens(userId, reset.hash);
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, username, password } = req.body as Record<string, unknown>;

  if (typeof email !== "string" || typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username, email, and password are required" });
    return;
  }
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    res.status(400).json({
      error: "Username must be 3-32 characters and only contain letters, numbers, or underscores",
    });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const passwordHash = await hashPassword(password);

  // Create user + portfolio atomically so registration never leaves a partial state.
  const client = await getPool().connect();
  let userId: number;
  try {
    await client.query("BEGIN");
    const user = await createUser(normalizedEmail, normalizedUsername, passwordHash, client);
    userId = user.userId;
    await client.query(`INSERT INTO portfolios (user_id, lp_balance) VALUES ($1, $2)`, [
      userId,
      STARTING_LP,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    // Unique violation: two registrations with the same email landed simultaneously.
    if ((err as NodeJS.ErrnoException & { code?: string }).code === "23505") {
      res.status(409).json({ error: REGISTER_CONFLICT_ERROR });
      return;
    }
    throw err;
  } finally {
    client.release();
  }

  const { token, hash, expiresAt } = generateSessionToken();
  await createSession(userId, hash, expiresAt);
  setSessionCookie(res, token, expiresAt);

  // Send verification email; don't block the response on delivery.
  issueVerificationEmail(userId, normalizedEmail).catch((err) =>
    console.error("Failed to send verification email:", err),
  );

  res.status(201).json({
    userId,
    email: normalizedEmail,
    username: normalizedUsername,
    emailVerified: false,
    emailVerifiedAt: null,
  });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { identifier, email, password } = req.body as Record<string, unknown>;
  const loginIdentifier = typeof identifier === "string" ? identifier : email;

  if (typeof loginIdentifier !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email/username and password are required" });
    return;
  }
  const normalizedIdentifier = normalizeLoginIdentifier(loginIdentifier);
  if (!normalizedIdentifier) {
    res.status(400).json({ error: "Enter a valid email address or username" });
    return;
  }

  const user =
    normalizedIdentifier.kind === "email"
      ? await findUserByEmail(normalizedIdentifier.value)
      : await findUserByUsername(normalizedIdentifier.value);
  // Use constant-time comparison; always run verifyPassword even on miss to prevent timing attacks.
  const hashToCompare = user?.passwordHash ?? "$2b$12$invalidhashpadding000000000000000000000000000000000000000";
  const valid = await verifyPassword(password, hashToCompare);

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid email/username or password" });
    return;
  }

  const { token, hash, expiresAt } = generateSessionToken();
  await createSession(user.userId, hash, expiresAt);
  setSessionCookie(res, token, expiresAt);

  res.json(toAuthUser(user));
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body as Record<string, unknown>;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    res.status(400).json({ error: "Valid email address is required" });
    return;
  }

  const user = await findUserByEmail(normalizedEmail);
  if (user) {
    issuePasswordResetEmail(user.userId, user.email).catch((err) =>
      console.error("Failed to send password reset email:", err),
    );
  }

  // Always return success to avoid revealing which emails exist.
  res.json({ ok: true });
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body as Record<string, unknown>;

  if (typeof token !== "string" || token.length === 0) {
    res.status(400).json({ error: "Reset token is required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await findPasswordResetToken(tokenHash);
  if (!row) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  const passwordHash = await hashPassword(password);
  await consumePasswordResetToken(row.tokenId, row.userId, passwordHash);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    // Extract and revoke the current session token if present.
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx < 0) continue;
      if (part.slice(0, idx).trim() !== "les_session") continue;
      try {
        const token = decodeURIComponent(part.slice(idx + 1).trim());
        await revokeSession(hashToken(token));
      } catch {
        // Best-effort revocation; still clear the cookie.
      }
      break;
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

// GET /api/auth/profile-change-status
router.get("/profile-change-status", requireAuth, async (req, res) => {
  const user = await findUserById(req.user!.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    username: profileChangeStatus("Username", user.usernameChangedAt),
    email: profileChangeStatus("Email", user.emailChangeRequestedAt),
  });
});

// POST /api/auth/verify-email
router.post("/verify-email", async (req, res) => {
  const { token } = req.body as Record<string, unknown>;

  if (typeof token !== "string" || token.length === 0) {
    res.status(400).json({ error: "Verification token is required" });
    return;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await findVerificationToken(tokenHash);

  if (!row) {
    const record = await findVerificationTokenRecord(tokenHash);
    if (!record) {
      res.status(400).json({ error: "Invalid or expired verification token" });
      return;
    }

    // Treat already-consumed tokens as success when the user is already
    // verified, so duplicate requests (React Strict Mode, link prefetch, etc.)
    // don't surface a false invalid-token error.
    if (record.usedAt) {
      const user = await findUserById(record.userId);
      if (user?.emailVerifiedAt) {
        res.json({ ok: true });
        return;
      }
    }

    res.status(400).json({ error: "Invalid or expired verification token" });
    return;
  }

  await consumeVerificationToken(row.tokenId, row.userId);
  res.json({ ok: true });
});

// POST /api/auth/resend-verification
router.post("/resend-verification", requireAuth, resendUserLimiter, async (req, res) => {
  const user = await findUserById(req.user!.userId);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.emailVerifiedAt && !user.pendingEmail) {
    res.status(400).json({ error: "Email is already verified" });
    return;
  }

  await issueVerificationEmail(user.userId, user.pendingEmail ?? user.email);

  res.json({ ok: true });
});

// POST /api/auth/request-password-reset
router.post(
  "/request-password-reset",
  requireAuth,
  requestPasswordResetUserLimiter,
  async (req, res) => {
    const user = await findUserById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await issuePasswordResetEmail(user.userId, user.email);
    res.json({ ok: true });
  },
);

// POST /api/auth/update-profile
router.post("/update-profile", requireAuth, profileUpdateLimiter, async (req, res) => {
  const { username, email, password } = req.body as Record<string, unknown>;
  if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username, email, and current password are required" });
    return;
  }

  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    res.status(400).json({
      error: "Username must be 3-32 characters and only contain letters, numbers, or underscores",
    });
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const user = await findUserById(req.user!.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    res.status(401).json({ error: "Entered password is incorrect" });
    return;
  }

  const usernameChanged = normalizedUsername !== user.username;
  const emailMatchesCurrent = normalizedEmail === user.email;
  const emailMatchesPending = user.pendingEmail !== null && normalizedEmail === user.pendingEmail;
  const emailChanged = !emailMatchesCurrent && !emailMatchesPending;

  if (!usernameChanged && emailMatchesCurrent) {
    res.status(400).json({ error: "No profile changes submitted" });
    return;
  }
  if (!usernameChanged && emailMatchesPending) {
    res.status(400).json({ error: "This email change is already pending verification" });
    return;
  }

  if (usernameChanged) {
    const cooldown = getProfileChangeCooldown(user.usernameChangedAt);
    if (!cooldown.allowed) {
      res.status(429).json({ error: profileChangeRateLimitError("Username", cooldown.retryAfterMs) });
      return;
    }
  }
  if (emailChanged) {
    const cooldown = getProfileChangeCooldown(user.emailChangeRequestedAt);
    if (!cooldown.allowed) {
      res.status(429).json({ error: profileChangeRateLimitError("Email", cooldown.retryAfterMs) });
      return;
    }

    const emailTaken = await findUserByAnyEmail(normalizedEmail, user.userId);
    if (emailTaken) {
      res.status(409).json({ error: REGISTER_CONFLICT_ERROR });
      return;
    }
  }

  let updated = user;
  if (usernameChanged) {
    try {
      const usernameUpdated = await updateUsername(user.userId, normalizedUsername);
      if (!usernameUpdated) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      updated = usernameUpdated;
    } catch (err) {
      if ((err as NodeJS.ErrnoException & { code?: string }).code === "23505") {
        res.status(409).json({ error: REGISTER_CONFLICT_ERROR });
        return;
      }
      throw err;
    }
  }

  if (emailChanged) {
    let withPendingEmail;
    try {
      withPendingEmail = await requestEmailChange(user.userId, normalizedEmail);
    } catch (err) {
      if ((err as NodeJS.ErrnoException & { code?: string }).code === "23505") {
        res.status(409).json({ error: REGISTER_CONFLICT_ERROR });
        return;
      }
      throw err;
    }
    if (!withPendingEmail) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    try {
      await issueVerificationEmail(withPendingEmail.userId, normalizedEmail);
    } catch (err) {
      await clearPendingEmailChange(withPendingEmail.userId);
      throw err;
    }
    updated = withPendingEmail;
  }

  res.json(toAuthUser(updated));
});

export default router;
