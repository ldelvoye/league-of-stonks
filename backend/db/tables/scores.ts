import { getPool } from "../index.js";

export type ScoreSnapshotSource = "snapshot" | "confirmed" | "estimated";

export interface ScoreSnapshot {
  id: number;
  playerId: number;
  score: number | null;
  recordedAt: Date;
  matchId: string | null;
  gameEndedAt: Date | null;
  source: ScoreSnapshotSource;
  won: boolean | null;
  championName: string | null;
  queueId: number | null;
}

const SCORE_SNAPSHOT_SELECT = `
  id,
  player_id,
  score,
  recorded_at,
  match_id,
  game_ended_at,
  source,
  won,
  champion_name,
  queue_id,
  COALESCE(game_ended_at, recorded_at) AS effective_recorded_at
`;

function mapScoreSnapshot(row: Record<string, unknown>): ScoreSnapshot {
  return {
    id: row.id as number,
    playerId: row.player_id as number,
    score: (row.score as number | null) ?? null,
    recordedAt: row.effective_recorded_at as Date,
    matchId: (row.match_id as string | null) ?? null,
    gameEndedAt: (row.game_ended_at as Date | null) ?? null,
    source: row.source as ScoreSnapshotSource,
    won: (row.won as boolean | null) ?? null,
    championName: (row.champion_name as string | null) ?? null,
    queueId: (row.queue_id as number | null) ?? null,
  };
}

export async function recordScoreSnapshot(
  playerId: number,
  score: number | null,
): Promise<ScoreSnapshot> {
  const { rows } = await getPool().query(
    `INSERT INTO score_snapshots (player_id, score, source)
     VALUES ($1, $2, 'snapshot')
     RETURNING ${SCORE_SNAPSHOT_SELECT}`,
    [playerId, score],
  );

  return mapScoreSnapshot(rows[0]);
}

export interface MatchScoreSnapshotInput {
  playerId: number;
  matchId: string;
  score: number | null;
  gameEndedAt: Date;
  source: "snapshot" | "confirmed" | "estimated";
  won?: boolean | null;
  championName?: string | null;
  queueId?: number | null;
}

export async function recordMatchScoreSnapshot(input: MatchScoreSnapshotInput): Promise<ScoreSnapshot> {
  const { playerId, matchId, score, gameEndedAt, source, won = null, championName = null, queueId = null } =
    input;

  const { rows } = await getPool().query(
    `INSERT INTO score_snapshots (
       player_id,
       score,
       recorded_at,
       match_id,
       game_ended_at,
       source,
       won,
       champion_name,
       queue_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (player_id, match_id) WHERE match_id IS NOT NULL
     DO UPDATE SET
       score = CASE
         WHEN score_snapshots.source = 'confirmed' AND EXCLUDED.source <> 'confirmed'
           THEN score_snapshots.score
         ELSE EXCLUDED.score
       END,
       recorded_at = CASE
         WHEN score_snapshots.source = 'confirmed' AND EXCLUDED.source <> 'confirmed'
           THEN score_snapshots.recorded_at
         ELSE EXCLUDED.recorded_at
       END,
       game_ended_at = COALESCE(score_snapshots.game_ended_at, EXCLUDED.game_ended_at),
       source = CASE
         WHEN score_snapshots.source = 'confirmed' THEN 'confirmed'
         ELSE EXCLUDED.source
       END,
       won = COALESCE(score_snapshots.won, EXCLUDED.won),
       champion_name = COALESCE(score_snapshots.champion_name, EXCLUDED.champion_name),
       queue_id = COALESCE(score_snapshots.queue_id, EXCLUDED.queue_id)
     RETURNING ${SCORE_SNAPSHOT_SELECT}`,
    [playerId, score, gameEndedAt, matchId, gameEndedAt, source, won, championName, queueId],
  );

  return mapScoreSnapshot(rows[0]);
}

export async function getLatestConfirmedMatchId(playerId: number): Promise<string | null> {
  const { rows } = await getPool().query<{ match_id: string | null }>(
    `SELECT match_id
     FROM score_snapshots
     WHERE player_id = $1
       AND source = 'confirmed'
       AND match_id IS NOT NULL
     ORDER BY COALESCE(game_ended_at, recorded_at) DESC
     LIMIT 1`,
    [playerId],
  );

  return rows[0]?.match_id ?? null;
}

export async function getScoreHistory(
  playerId: number,
  { limit = 100 }: { limit?: number } = {},
): Promise<ScoreSnapshot[]> {
  const { rows } = await getPool().query(
    `SELECT ${SCORE_SNAPSHOT_SELECT}
     FROM score_snapshots
     WHERE player_id = $1
     ORDER BY COALESCE(game_ended_at, recorded_at) DESC
     LIMIT $2`,
    [playerId, limit],
  );

  return rows.map((row) => mapScoreSnapshot(row as Record<string, unknown>));
}
