import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

// Built once on first use so it reflects the env at startup time.
let _allowedOrigins: Set<string> | null = null;

function getAllowedOrigins(): Set<string> {
  if (!_allowedOrigins) {
    _allowedOrigins = new Set(config.allowedOrigins());
  }
  return _allowedOrigins;
}

/**
 * Rejects state-changing requests where the browser-set `Origin` header does
 * not match an allowed origin. Requests without an `Origin` header (e.g. curl,
 * server-to-server calls) are allowed through; cookie-based CSRF attacks always
 * include an Origin header in modern browsers.
 *
 * SameSite=Lax cookies already block most cross-site mutations, so this is a
 * defense-in-depth layer for POST routes that carry cookie-authenticated state.
 */
export function requireSafeOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  if (!getAllowedOrigins().has(origin)) {
    res.status(403).json({ error: "Request origin not allowed" });
    return;
  }
  next();
}

// Exposed for testing: resets the cached origin set so tests can change env vars.
export function resetAllowedOriginsCache(): void {
  _allowedOrigins = null;
}
