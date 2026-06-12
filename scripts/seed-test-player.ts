import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { closeDb, getPool, initDb } from "../backend/db/index.js";

const TEST_PLAYER = {
  gameName: "TestStonks",
  tagLine: "NA1",
  platform: "na1",
  puuid: "00000000-0000-0000-0000-000000000001",
};

const DAYS = 30;

// Deterministic pseudo-random walk so re-seeding produces the same chart.
function seededScore(dayIndex: number, previous: number): number {
  const wave = Math.sin(dayIndex / 4.5) * 55;
  const drift = dayIndex * 1.8;
  const noise = (((dayIndex * 17 + 3) % 13) - 6) * 12;
  const dip = dayIndex % 9 === 0 ? -35 : 0;
  const raw = 1850 + wave + drift + noise + dip;
  const blended = previous * 0.35 + raw * 0.65;
  return Math.round(Math.max(1600, Math.min(2400, blended)));
}

function snapshotTimestamp(dayIndex: number): Date {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  // dayIndex 0 = oldest (29 days ago), dayIndex 29 = today.
  date.setDate(date.getDate() - (DAYS - 1 - dayIndex));
  return date;
}

async function main(): Promise<void> {
  await initDb();
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
    const score = seededScore(day, previous);
    previous = score;
    await pool.query(
      `INSERT INTO score_snapshots (player_id, score, recorded_at)
       VALUES ($1, $2, $3)`,
      [playerId, score, snapshotTimestamp(day)],
    );
  }

  const riotId = `${TEST_PLAYER.gameName}#${TEST_PLAYER.tagLine}`;
  console.log(`Seeded ${DAYS} daily snapshots for ${riotId} (${TEST_PLAYER.platform}).`);
  console.log(`Open: http://localhost:3000/#/player/${encodeURIComponent(TEST_PLAYER.gameName)}/${encodeURIComponent(TEST_PLAYER.tagLine)}`);

  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
