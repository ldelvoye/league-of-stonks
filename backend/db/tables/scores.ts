import { getPool } from "../index.js";

export interface ScoreSnapshot {
  id: number;
  playerId: number;
  score: number | null;
  recordedAt: Date;
}

export async function recordScoreSnapshot(
  playerId: number,
  score: number | null,
): Promise<ScoreSnapshot> {
  const { rows } = await getPool().query(
    `INSERT INTO score_snapshots (player_id, score)
     VALUES ($1, $2)
     RETURNING id, player_id, score, recorded_at`,
    [playerId, score],
  );

  const row = rows[0];
  return {
    id: row.id,
    playerId: row.player_id,
    score: row.score,
    recordedAt: row.recorded_at,
  };
}

export async function getScoreHistory(
  playerId: number,
  { limit = 100 }: { limit?: number } = {},
): Promise<ScoreSnapshot[]> {
  const { rows } = await getPool().query(
    `SELECT id, player_id, score, recorded_at
     FROM score_snapshots
     WHERE player_id = $1
     ORDER BY recorded_at DESC
     LIMIT $2`,
    [playerId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    playerId: row.player_id,
    score: row.score,
    recordedAt: row.recorded_at,
  }));
}
