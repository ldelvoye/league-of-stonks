import { createHash } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getPool } from "../db/index.js";
import {
  consumeVerificationToken,
  createVerificationToken,
  findVerificationToken,
  generateVerificationToken,
  revokePendingVerificationTokens,
  revokeVerificationToken,
} from "../db/emailVerification.js";
import { STARTING_LP } from "../db/portfolios.js";
import { findUserByEmail, findUserById } from "../db/users.js";
import { revokeSession, createSession } from "../db/sessions.js";
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
import { sendVerificationEmail } from "../lib/email.js";

const router = Router();
const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  if (!BASIC_EMAIL_REGEX.test(normalized)) return null;
  return normalized;
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

router.use("/login", authLimiter);
router.use("/register", authLimiter);
router.use("/resend-verification", resendIpLimiter);
router.use("/verify-email", verifyEmailLimiter);

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, password } = req.body as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await hashPassword(password);

  // Create user + portfolio atomically so registration never leaves a partial state.
  const client = await getPool().connect();
  let userId: number;
  try {
    await client.query("BEGIN");
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash) VALUES (LOWER($1), $2) RETURNING user_id`,
      [normalizedEmail, passwordHash],
    );
    userId = userRows[0].user_id as number;
    await client.query(`INSERT INTO portfolios (user_id, lp_balance) VALUES ($1, $2)`, [
      userId,
      STARTING_LP,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    // Unique violation: two registrations with the same email landed simultaneously.
    if ((err as NodeJS.ErrnoException & { code?: string }).code === "23505") {
      res.status(409).json({ error: "Email already registered" });
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
  const verif = generateVerificationToken();
  createVerificationToken(userId, verif.hash, verif.expiresAt)
    .then(() => sendVerificationEmail(normalizedEmail, verif.token))
    .catch((err) => console.error("Failed to send verification email:", err));

  res.status(201).json({
    userId,
    email: normalizedEmail,
    emailVerified: false,
    emailVerifiedAt: null,
  });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const user = await findUserByEmail(normalizedEmail);
  // Use constant-time comparison; always run verifyPassword even on miss to prevent timing attacks.
  const hashToCompare = user?.passwordHash ?? "$2b$12$invalidhashpadding000000000000000000000000000000000000000";
  const valid = await verifyPassword(password, hashToCompare);

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const { token, hash, expiresAt } = generateSessionToken();
  await createSession(user.userId, hash, expiresAt);
  setSessionCookie(res, token, expiresAt);

  res.json(toAuthUser(user));
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
  if (user.emailVerifiedAt) {
    res.status(400).json({ error: "Email is already verified" });
    return;
  }

  const verif = generateVerificationToken();
  await createVerificationToken(user.userId, verif.hash, verif.expiresAt);
  try {
    await sendVerificationEmail(user.email, verif.token);
  } catch (err) {
    await revokeVerificationToken(verif.hash);
    throw err;
  }
  await revokePendingVerificationTokens(user.userId, verif.hash);

  res.json({ ok: true });
});

export default router;
