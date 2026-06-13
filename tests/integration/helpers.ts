import { vi } from "vitest";
import { closeDb, getPool, initDb } from "../../backend/db/index.ts";
import { runMigrations } from "../../backend/db/migrations.ts";

const LOCAL_DB_URL = "postgresql://postgres:postgres@localhost:5432/league_of_stonks";

export const TEST_PASSWORD = "password123";

function ensureSafeLocalDatabase(connectionString: string): void {
  const normalized = connectionString.replace(/^postgres:/, "postgresql:");
  const url = new URL(normalized);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(
      `Refusing to run integration tests against non-local database host: ${url.hostname}`,
    );
  }
}

export function configureIntegrationEnv(): void {
  process.env.NODE_ENV = "test";
  process.env.ALLOWED_ORIGINS = "http://localhost:3001";
  process.env.RESEND_API_KEY = "";
  process.env.RIOT_API_KEY = "test-riot-key";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DB_URL;
}

export async function initIntegrationDb(): Promise<void> {
  configureIntegrationEnv();
  ensureSafeLocalDatabase(process.env.DATABASE_URL as string);
  await initDb();
  await runMigrations();
}

export async function closeIntegrationDb(): Promise<void> {
  vi.unstubAllGlobals();
  await closeDb();
}

export async function resetDatabase(): Promise<void> {
  await getPool().query(`
    TRUNCATE TABLE
      app_meta,
      password_reset_tokens,
      email_verification_tokens,
      sessions,
      portfolio_trades,
      portfolio_positions,
      score_snapshots,
      portfolios,
      users,
      players
    RESTART IDENTITY CASCADE
  `);
}

export async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

export function mockRiotFetchWith({
  accountStatus = 200,
  accountBody = { puuid: "puuid-1", gameName: "Faker", tagLine: "KR1" },
  leagueStatus = 200,
  leagueBody = [
    {
      queueType: "RANKED_SOLO_5x5",
      tier: "GOLD",
      rank: "II",
      leaguePoints: 50,
    },
  ],
  throwError,
}: {
  accountStatus?: number;
  accountBody?: unknown;
  leagueStatus?: number;
  leagueBody?: unknown;
  throwError?: Error;
} = {}): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (throwError) {
      throw throwError;
    }

    const url = String(input);
    if (url.includes("/riot/account/v1/accounts/by-riot-id/")) {
      return new Response(JSON.stringify(accountBody), { status: accountStatus });
    }
    if (url.includes("/lol/league/v4/entries/by-puuid/")) {
      return new Response(JSON.stringify(leagueBody), { status: leagueStatus });
    }
    return new Response(JSON.stringify({ error: "Not mocked" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
}

export async function resetIntegrationState(): Promise<void> {
  await resetDatabase();
  vi.restoreAllMocks();
  mockRiotFetchWith({
    throwError: new Error("Unexpected external Riot API call in this test"),
  });
}
