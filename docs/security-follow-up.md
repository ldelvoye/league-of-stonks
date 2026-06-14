# Security Follow-Up

This document covers security work that was intentionally deferred during the post-MVP scalability pass. The scalability pass focused on correctness, performance, and abuse prevention at the API level. The items below require deeper investment and should be prioritized as traffic grows.

---

## 1. WAF / Bot Management

**Status:** Not implemented.

A web application firewall and bot-management layer (Cloudflare, AWS WAF, or similar) would provide:

- Challenge pages and CAPTCHA for high-volume scrapers
- IP reputation filtering before requests reach the application
- DDoS absorption without consuming application-level rate-limit budgets
- Geo-blocking if the game is only targeted at specific regions

**Priority:** Medium. The current IP-based `express-rate-limit` is a first line of defense but cannot handle distributed bot traffic from thousands of IPs.

---

## 2. Public API Keys / API Gateway

**Status:** Not implemented.

All current routes are either public (market/player data) or session-authenticated. There is no mechanism for third-party clients to access the API with a stable identity. When third-party tooling or automated scripts become common, introduce:

- API key issuance and management (keys stored hashed in the database)
- Per-key rate limits tracked in Redis or a dedicated store
- A reverse-proxy gateway (Kong, AWS API Gateway, or Traefik) for policy enforcement

**Priority:** Low until external integrations are a product goal.

---

## 3. Redis-Backed Distributed Abuse Detection

**Status:** Not implemented. Current rate limits use in-process `MemoryStore`.

The in-process `express-rate-limit` store resets on every process restart and is not shared across multiple server instances. In a horizontally-scaled deployment:

- Use `rate-limit-redis` or `ioredis` as the backing store
- Consider sliding-window counters for smoother limiting
- Track per-user as well as per-IP for authenticated endpoints

**Priority:** High if multiple instances are deployed behind a load balancer.

---

## 4. Audit Logging

**Status:** Not implemented.

Security-relevant events are currently captured only in structured application logs. A dedicated audit log should record:

- Account creation, email changes, and password resets with timestamps and IP
- Portfolio trades (player, side, shares, price, IP)
- Failed authentication attempts (rate-limited or otherwise)
- Admin actions once an admin interface exists

Audit logs should be append-only and stored separately from application logs to prevent tampering.

**Priority:** Medium. Required for any meaningful security incident response.

---

## 5. Content Security Policy (CSP) Hardening

**Status:** Not implemented.

The frontend does not set a Content-Security-Policy header. A strict CSP would:

- Restrict script sources to `'self'` and specific CDNs
- Block inline scripts (`'unsafe-inline'` removed)
- Prevent data exfiltration via `connect-src`

Recommended path: use a nonce-based CSP configured via the backend's response headers, or Vite's meta-tag approach for static hosting.

**Priority:** Medium. Mitigates XSS impact if a vulnerability is found.

---

## 6. Dependency and Secrets Scanning

**Status:** Not implemented.

- Integrate `npm audit` or Snyk into CI to catch vulnerable transitive dependencies
- Add secret-scanning (GitHub secret scanning, TruffleHog) to the repository
- Establish a secrets rotation policy for `RIOT_API_KEY`, database credentials, and session secrets

**Priority:** Medium. Low implementation cost, high signal-to-noise value in CI.

---

## 7. Penetration Testing

**Status:** Not performed.

A structured penetration test (even a lightweight one via a tool like `zaproxy` or a manual review) should be conducted before the application handles significant user data or real money-equivalent LP values. Focus areas:

- Authentication flows (registration, login, password reset, email verification)
- Session fixation and cookie security attributes
- IDOR on portfolio and trade endpoints
- Mass assignment via the profile update endpoint

**Priority:** Medium-high once the user base grows beyond early testers.

---

## 8. HTTPS and Cookie Security

**Status:** Partially addressed.

Session cookies should be audited for:

- `Secure` flag set (cookies must only be sent over HTTPS)
- `SameSite=Strict` or `SameSite=Lax` to prevent CSRF on mutation routes
- `HttpOnly` set to prevent JavaScript access
- Short `maxAge` for session tokens with refresh on activity

Ensure the production deployment terminates TLS at the edge (Railway or the load balancer) and that HTTP is redirected to HTTPS.

**Priority:** High. These settings should be verified before any public launch.

---

## 9. Account Takeover Protections

**Status:** Not implemented.

Beyond rate limiting, consider:

- Email notification on password change and new device login
- Device/session list for users to view and revoke active sessions
- Lockout after N failed login attempts (with exponential backoff)
- Breached-password check via the `pwned` API on registration and password change

**Priority:** Medium-high as the user base grows.
