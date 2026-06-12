import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { findSession } from "../db/sessions.js";
import { findUserById, type User } from "../db/users.js";

const SESSION_COOKIE = "les_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 12;

export interface AuthenticatedUser {
  userId: number;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
}

export function toAuthUser(user: Pick<User, "userId" | "email" | "emailVerifiedAt">): AuthenticatedUser {
  return {
    userId: user.userId,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}

// Augment Express Request so req.user is typed everywhere auth middleware runs.
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateSessionToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_DURATION_MS) };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function getSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

export async function authenticateRequest(req: Request): Promise<AuthenticatedUser | null> {
  const token = getSessionToken(req);
  if (!token) return null;

  const session = await findSession(hashToken(token));
  if (!session) return null;

  const user = await findUserById(session.userId);
  if (!user) return null;

  return toAuthUser(user);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  authenticateRequest(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      req.user = user;
      next();
    })
    .catch(next);
}
