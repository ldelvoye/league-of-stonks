import { vi } from "vitest";
import { closeDb, getPool, initDb } from "../../backend/db/index.ts";
import { runMigrations } from "../../backend/db/migrations.ts";

const LOCAL_DB_URL = "postgresql://postgres:postgres@localhost:5432/league_of_stonks";

export const TEST_PASSWORD = "password123";
let riotFetchCalls: string[] = [];

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

export function clearRiotFetchCalls(): void {
  riotFetchCalls = [];
}

export function getRiotFetchCalls(): string[] {
  return riotFetchCalls.slice();
}

export function countRiotFetchCalls(pattern: string | RegExp): number {
  const matcher = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  return riotFetchCalls.filter((url) => matcher.test(url)).length;
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
  matchIdsStatus = 200,
  matchIdsBody = ["NA1_3", "NA1_2", "NA1_1"],
  matchByIdStatus = 200,
  matchById = {},
  throwError,
}: {
  accountStatus?: number;
  accountBody?: unknown;
  leagueStatus?: number;
  leagueBody?: unknown;
  matchIdsStatus?: number;
  matchIdsBody?: string[];
  matchByIdStatus?: number;
  matchById?: Record<string, unknown>;
  throwError?: Error;
} = {}): void {
  clearRiotFetchCalls();
  const now = Date.now() - 24 * 60 * 60 * 1000;
  const account = accountBody as { puuid?: string; gameName?: string; tagLine?: string };
  const targetPuuid = account.puuid ?? "puuid-1";
  const targetGameName = account.gameName ?? "Faker";
  const targetTagLine = account.tagLine ?? "KR1";

  const defaultMatches = Object.fromEntries(
    matchIdsBody.map((matchId, index) => [
      matchId,
      {
        metadata: { matchId },
        info: {
          gameEndTimestamp: now - index * 60 * 60 * 1000,
          queueId: 420,
          participants: [
            {
              puuid: targetPuuid,
              win: index % 2 === 0,
              championName: "Ahri",
              riotIdGameName: targetGameName,
              riotIdTagline: targetTagLine,
            },
          ],
        },
      },
    ]),
  );

  const matchPayloadById = { ...defaultMatches, ...matchById };

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (throwError) {
      throw throwError;
    }

    const url = String(input);
    riotFetchCalls.push(url);
    if (url.includes("/riot/account/v1/accounts/by-riot-id/")) {
      return new Response(JSON.stringify(accountBody), { status: accountStatus });
    }
    if (url.includes("/lol/league/v4/entries/by-puuid/")) {
      return new Response(JSON.stringify(leagueBody), { status: leagueStatus });
    }
    if (url.includes("/lol/match/v5/matches/by-puuid/") && url.includes("/ids")) {
      return new Response(JSON.stringify(matchIdsBody), { status: matchIdsStatus });
    }
    if (url.includes("/lol/match/v5/matches/")) {
      const raw = url.split("/lol/match/v5/matches/")[1] ?? "";
      const matchId = decodeURIComponent(raw.split("?")[0]);
      const payload = matchPayloadById[matchId];
      if (!payload) {
        return new Response(JSON.stringify({ error: "Match not mocked" }), { status: 404 });
      }
      return new Response(JSON.stringify(payload), { status: matchByIdStatus });
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
