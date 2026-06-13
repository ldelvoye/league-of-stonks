import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { closeDb, getPool, initDb } from "../backend/db/index.js";
import { runMigrations } from "../backend/db/migrations.js";

const TEST_PLAYER = {
  gameName: "TestStonks",
  tagLine: "NA1",
  platform: "na1",
  puuid: "00000000-0000-0000-0000-000000000001",
};

const DAYS = 30;
const MIN_SCORE = 1600;
const MAX_SCORE = 2400;
const RANDOM_DELTA_MIN = 15;
const RANDOM_DELTA_MAX = 75;
const RANDOM_TICK_OFFSET_MS = 5 * 60 * 1000;

// Deterministic pseudo-random walk so re-seeding produces the same chart.
function seededBaselineScore(dayIndex: number, previous: number): number {
  const wave = Math.sin(dayIndex / 4.5) * 55;
  const drift = dayIndex * 1.8;
  const noise = (((dayIndex * 17 + 3) % 13) - 6) * 12;
  const dip = dayIndex % 9 === 0 ? -35 : 0;
  const raw = 1850 + wave + drift + noise + dip;
  const blended = previous * 0.35 + raw * 0.65;
  return Math.round(Math.max(MIN_SCORE, Math.min(MAX_SCORE, blended)));
}

function snapshotTimestamp(dayIndex: number): Date {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  // dayIndex 0 = oldest (29 days ago), dayIndex 29 = today.
  date.setDate(date.getDate() - (DAYS - 1 - dayIndex));
  return date;
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function appendRandomMovement(previous: number): { next: number; delta: number } {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const direction = Math.random() < 0.5 ? -1 : 1;
    const magnitude = randomIntInclusive(RANDOM_DELTA_MIN, RANDOM_DELTA_MAX);
    const candidate = Math.max(MIN_SCORE, Math.min(MAX_SCORE, previous + direction * magnitude));
    if (candidate !== previous) {
      return { next: candidate, delta: candidate - previous };
    }
  }

  // Extremely unlikely fallback if random attempts are clamped at boundaries.
  const fallback = previous >= MAX_SCORE ? previous - RANDOM_DELTA_MIN : previous + RANDOM_DELTA_MIN;
  return { next: fallback, delta: fallback - previous };
}

async function main(): Promise<void> {
  await initDb();
  await runMigrations();
  const pool = getPool();

  const { rows: playerRows } = await pool.query(
    `INSERT INTO players (game_name, tag_line, puuid, platform)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (game_name, tag_line, platform)
     DO UPDATE SET
       puuid = EXCLUDED.puuid,
       updated_at = NOW()
     RETURNING player_id`,
    [TEST_PLAYER.gameName, TEST_PLAYER.tagLine, TEST_PLAYER.puuid, TEST_PLAYER.platform],
  );

  const playerId = playerRows[0].player_id as number;

  await pool.query(`DELETE FROM score_snapshots WHERE player_id = $1`, [playerId]);

  let previous = 1850;
  for (let day = 0; day < DAYS; day++) {
    const score = seededBaselineScore(day, previous);
    previous = score;
    await pool.query(
      `INSERT INTO score_snapshots (player_id, score, recorded_at)
       VALUES ($1, $2, $3)`,
      [playerId, score, snapshotTimestamp(day)],
    );
  }

  const randomTick = appendRandomMovement(previous);
  const randomTickTimestamp = new Date(snapshotTimestamp(DAYS - 1).getTime() + RANDOM_TICK_OFFSET_MS);
  await pool.query(
    `INSERT INTO score_snapshots (player_id, score, recorded_at)
     VALUES ($1, $2, $3)`,
    [playerId, randomTick.next, randomTickTimestamp],
  );

  const riotId = `${TEST_PLAYER.gameName}#${TEST_PLAYER.tagLine}`;
  const deltaText = randomTick.delta > 0 ? `+${randomTick.delta}` : String(randomTick.delta);
  console.log(
    `Seeded ${DAYS} baseline daily snapshots for ${riotId} (${TEST_PLAYER.platform}) and appended a random movement tick (${deltaText}).`,
  );
  console.log(`Open: http://localhost:3000/#/player/${encodeURIComponent(TEST_PLAYER.gameName)}/${encodeURIComponent(TEST_PLAYER.tagLine)}`);

  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
