export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(`Missing required environment variable: ${name}`);
  return value;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const num = Number(raw);
  if (!isFinite(num)) {
    throw new ConfigError(`${name} must be a number, got: ${JSON.stringify(raw)}`);
  }
  return num;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ConfigError(`${name} must be a boolean-like value, got: ${JSON.stringify(raw)}`);
}

/**
 * Validate all required environment variables at startup.
 * Call once in index.ts after dotenv is loaded, before starting the server.
 * Throws ConfigError on the first missing or malformed required variable.
 */
export function validateConfig(): void {
  required("DATABASE_URL");
  required("RIOT_API_KEY");
}

/**
 * Central runtime config. All values are read lazily (inside function bodies)
 * so that dotenv has a chance to populate process.env before they are accessed.
 */
export const config = {
  // ── Database ──────────────────────────────────────────────────────────────
  databaseUrl(): string {
    return required("DATABASE_URL");
  },
  dbPoolMax(): number {
    return envNum("DB_POOL_MAX", 10);
  },
  dbIdleTimeoutMs(): number {
    return envNum("DB_POOL_IDLE_TIMEOUT_MS", 30_000);
  },
  dbConnectionTimeoutMs(): number {
    return envNum("DB_POOL_CONNECTION_TIMEOUT_MS", 5_000);
  },
  dbStatementTimeoutMs(): number {
    return envNum("DB_STATEMENT_TIMEOUT_MS", 15_000);
  },

  // ── Riot API ──────────────────────────────────────────────────────────────
  riotApiKey(): string {
    return required("RIOT_API_KEY");
  },
  logVerboseRiotRequests(): boolean {
    return envBool("LOG_VERBOSE_RIOT_REQUESTS", false);
  },
  // Conservative budgets that reserve headroom for bursty user traffic.
  // Riot limits: 20/1s and 100/2min. We use 18/1s and 90/2min.
  riotOutboundLimitPerSecond(): number {
    return envNum("RIOT_OUTBOUND_LIMIT_PER_SECOND", 18);
  },
  riotOutboundLimitPer2Min(): number {
    return envNum("RIOT_OUTBOUND_LIMIT_PER_2MIN", 90);
  },

  // ── Cron jobs ─────────────────────────────────────────────────────────────
  cronSecret(): string | null {
    return process.env.CRON_SECRET ?? null;
  },
  // Max Riot calls consumed per 2-minute window before cron reduces/skips work.
  cronRiotBudgetThreshold(): number {
    return envNum("CRON_RIOT_BUDGET_THRESHOLD", 60);
  },

  // ── CORS / origin policy ──────────────────────────────────────────────────
  allowedOrigins(): string[] {
    const origins = (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    return origins.length > 0 ? origins : ["http://localhost:3001"];
  },

  // ── Scheduled jobs ────────────────────────────────────────────────────────
  leaderboardRefreshMs(): number {
    return envNum("LEADERBOARD_REFRESH_MS", 5 * 60 * 1000);
  },

  // ── Market cache TTLs ─────────────────────────────────────────────────────
  marketStatsTtlMs(): number {
    return envNum("CACHE_MARKET_STATS_TTL_MS", 60_000);
  },
  marketTopTtlMs(): number {
    return envNum("CACHE_MARKET_TOP_TTL_MS", 60_000);
  },
  marketRecentTradesTtlMs(): number {
    return envNum("CACHE_MARKET_RECENT_TRADES_TTL_MS", 15_000);
  },

  // ── Server ────────────────────────────────────────────────────────────────
  port(): number {
    return Number(process.env.PORT ?? 3000);
  },
  nodeEnv(): string {
    return process.env.NODE_ENV ?? "development";
  },
  isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
