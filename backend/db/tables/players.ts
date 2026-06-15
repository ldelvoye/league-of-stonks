import { getPool } from "../index.js";

export interface Player {
  playerId: number;
  gameName: string;
  tagLine: string;
  puuid: string;
  platform: string;
  createdAt: Date;
  updatedAt: Date;
}

const PLAYER_COLUMNS =
  "player_id, game_name, tag_line, puuid, platform, created_at, updated_at";

function mapPlayer(row: Record<string, unknown> | undefined): Player | null {
  if (!row) {
    return null;
  }

  return {
    playerId: row.player_id as number,
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    puuid: row.puuid as string,
    platform: row.platform as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function findPlayerByRiotId(
  gameName: string,
  tagLine: string,
  platform: string,
): Promise<Player | null> {
  const { rows } = await getPool().query(
    `SELECT ${PLAYER_COLUMNS}
     FROM players
     WHERE LOWER(game_name) = LOWER($1) AND LOWER(tag_line) = LOWER($2) AND platform = $3`,
    [gameName, tagLine, platform],
  );

  return mapPlayer(rows[0]);
}

export async function upsertPlayer(player: Omit<Player, "playerId" | "createdAt" | "updatedAt">): Promise<Player> {
  const { gameName, tagLine, puuid, platform } = player;
  const { rows } = await getPool().query(
    `INSERT INTO players (game_name, tag_line, puuid, platform)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (game_name, tag_line, platform)
     DO UPDATE SET
       puuid = EXCLUDED.puuid,
       updated_at = NOW()
     RETURNING ${PLAYER_COLUMNS}`,
    [gameName, tagLine, puuid, platform],
  );

  return mapPlayer(rows[0]) as Player;
}

export async function touchPlayer(playerId: number): Promise<void> {
  await getPool().query(`UPDATE players SET updated_at = NOW() WHERE player_id = $1`, [playerId]);
}

export interface StaleCandidateRow {
  playerId: number;
  gameName: string;
  tagLine: string;
  platform: string;
}

/**
 * Returns up to `limit` players that have not had a snapshot recorded in the
 * last 5 minutes, excluding any player IDs in `excludeIds`. Results are
 * randomised so repeated cron runs cycle through the full player pool over time.
 * Both players with no snapshots at all and players with stale snapshots are
 * eligible and treated equally.
 */
export async function queryRandomStalePlayers(
  limit: number,
  excludeIds: number[] = [],
  db = getPool(),
): Promise<StaleCandidateRow[]> {
  const { rows } = await db.query(
    `SELECT p.player_id, p.game_name, p.tag_line, p.platform
     FROM players p
     LEFT JOIN LATERAL (
       SELECT recorded_at
       FROM score_snapshots
       WHERE player_id = p.player_id
       ORDER BY recorded_at DESC
       LIMIT 1
     ) latest ON true
     WHERE (cardinality($2::int[]) = 0 OR p.player_id != ALL($2::int[]))
       AND (latest.recorded_at IS NULL OR latest.recorded_at < NOW() - INTERVAL '5 minutes')
     ORDER BY RANDOM()
     LIMIT $1`,
    [limit, excludeIds],
  );

  return rows.map((row) => ({
    playerId: row.player_id as number,
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    platform: row.platform as string,
  }));
}
