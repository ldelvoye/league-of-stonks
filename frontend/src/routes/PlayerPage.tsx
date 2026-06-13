import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { Snapshot } from "../../lib/types";
import { getScoreAndHistory, scoreErrorMessage } from "../../lib/api";
import {
  formatDate,
  formatPercent,
  formatScore,
  formatSignedScore,
  trendArrow,
  trendClass,
} from "../../lib/format";
import { filterByRange, RANGES, rangeByKey, type RangeKey } from "../../lib/ranges";
import { StatusMessage } from "../components/StatusMessage";
import { StockChart } from "../components/StockChart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

class PlayerRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(scoreErrorMessage(status));
    this.status = status;
  }
}

function firstScored(points: Snapshot[]): Snapshot | null {
  return points.find((point) => point.score !== null) ?? null;
}

function lastScored(points: Snapshot[]): Snapshot | null {
  for (let index = points.length - 1; index >= 0; index--) {
    if (points[index].score !== null) return points[index];
  }
  return null;
}

function errorStatus(error: unknown): number {
  if (error instanceof PlayerRequestError) return error.status;
  return 0;
}

export function PlayerPage() {
  const params = useParams<{ gameName: string; tagLine: string }>();
  const gameName = params.gameName ?? "";
  const tagLine = params.tagLine ?? "";

  const [range, setRange] = useState<RangeKey>("ALL");
  const [hoveredPoint, setHoveredPoint] = useState<Snapshot | null>(null);

  const playerQuery = useQuery({
    queryKey: ["player", gameName, tagLine],
    enabled: Boolean(gameName && tagLine),
    queryFn: async () => {
      const result = await getScoreAndHistory(gameName, tagLine);
      if (!result.ok || !result.data) throw new PlayerRequestError(result.status);
      return result.data;
    },
  });

  const data = playerQuery.data ?? null;
  const history = data?.history ?? [];
  const visible = useMemo(() => filterByRange(history, range), [history, range]);

  const baseline = firstScored(visible);
  const current = hoveredPoint ?? lastScored(visible);
  const scoreLabel = hoveredPoint ? "Score" : "Current score";
  const scoreContext = hoveredPoint
    ? formatDate(hoveredPoint.recordedAt)
    : rangeByKey(range).description;
  const currentScore = formatScore(current?.score) ?? "Unranked";

  const delta =
    baseline &&
    current &&
    baseline !== current &&
    baseline.score !== null &&
    current.score !== null
      ? current.score - baseline.score
      : null;
  const deltaText =
    delta == null
      ? null
      : baseline && baseline.score
        ? `${trendArrow(delta)} ${formatSignedScore(delta)} (${formatPercent((delta / baseline.score) * 100)})`
        : `${trendArrow(delta)} ${formatSignedScore(delta)}`;

  useEffect(() => {
    setRange("ALL");
    setHoveredPoint(null);
  }, [gameName, tagLine]);

  useEffect(() => {
    setHoveredPoint(null);
  }, [range]);

  useDocumentTitle(
    data ? `${data.gameName}#${data.tagLine} — League of Stonks` : "League of Stonks",
  );

  const handleHover = useCallback((point: Snapshot | null) => {
    setHoveredPoint(point);
  }, []);

  if (playerQuery.isPending) {
    return <StatusMessage text={`Loading ${gameName}#${tagLine}...`} variant="loading" />;
  }

  if (playerQuery.isError) {
    return <StatusMessage text={scoreErrorMessage(errorStatus(playerQuery.error))} variant="error" />;
  }

  if (!data) {
    return <StatusMessage text="No player data available." variant="error" />;
  }

  const hasData = history.length > 0;
  const latest = history[history.length - 1] ?? null;

  return (
    <section className="player-card">
      <div className="player-head">
        <div className="player-id">
          <h2 className="player-name">{data.gameName}</h2>
          <span className="player-tag">#{data.tagLine}</span>
        </div>

        <div className="player-score">
          <span className="score-label">{scoreLabel}</span>
          <span className="score-value">{currentScore}</span>
          <div className="score-trend">
            {deltaText ? (
              <span className={`score-change ${trendClass(delta ?? 0)}`}>{deltaText}</span>
            ) : null}
            <span className="score-context">{scoreContext}</span>
          </div>
        </div>

        <button
          className={`btn btn-ghost ${playerQuery.isRefetching ? "is-busy" : ""}`}
          type="button"
          onClick={() => void playerQuery.refetch()}
          disabled={playerQuery.isRefetching}
        >
          <span className="refresh-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </span>
          <span className="refresh-label">{playerQuery.isRefetching ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>

      <div className="player-meta">
        <span>{history.length === 1 ? "1 snapshot" : `${history.length} snapshots`}</span>
        <span>{latest ? `Last recorded ${formatDate(latest.recordedAt)}` : ""}</span>
      </div>

      <div className="chart">
        {hasData ? (
          <>
            <div className="range-filters" role="group" aria-label="Time range">
              {RANGES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`range-btn ${range === option.key ? "is-active" : ""}`}
                  aria-label={option.description}
                  aria-pressed={range === option.key}
                  onClick={() => setRange(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <StockChart points={visible} onHover={handleHover} />
          </>
        ) : (
          <p className="history-empty">No score history recorded yet.</p>
        )}
      </div>
    </section>
  );
}
