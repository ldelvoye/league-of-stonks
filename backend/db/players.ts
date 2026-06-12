import { getPool } from "./index.js";

export interface Player {
  id: number;
  gameName: string;
  tagLine: string;
  puuid: string;
  platform: string;
  createdAt: Date;
  updatedAt: Date;
}

function mapPlayer(row: Record<string, unknown> | undefined): Player | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id as number,
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    puuid: row.puuid as string,
    platform: row.platform as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

const PLAYER_COLUMNS =
  "id, game_name, tag_line, puuid, platform, created_at, updated_at";

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

export async function upsertPlayer(player: Omit<Player, "id" | "createdAt" | "updatedAt">): Promise<Player> {
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
  await getPool().query(`UPDATE players SET updated_at = NOW() WHERE id = $1`, [playerId]);
}
