import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { Snapshot } from "../../lib/types.js";
import { scoreErrorMessage } from "../../lib/api.js";
import { formatDate } from "../../lib/format.js";
import { useDocumentTitle } from "../hooks/useDocumentTitle.js";
import { usePlayerData } from "../features/player/hooks/usePlayerData.js";
import { buildExternalProfileLinks } from "../lib/externalProfileLinks.js";
import { useAuth } from "../state/AuthContext.js";
import { usePortfolioQuery } from "../queries/portfolio.js";
import { PlayerChartPanel } from "../features/player/components/PlayerChartPanel.js";
import { PlayerTradePanel } from "../features/player/components/PlayerTradePanel.js";
import { StatusMessage } from "../components/StatusMessage.js";
import type { RangeKey } from "../../lib/ranges.js";

// Re-exported so existing import paths (e.g. any legacy references) still resolve.
export { normalizeSharesInput } from "../lib/tradeInput.js";

const LOW_CONFIDENCE_TRUSTED_POINTS = 6;
const LOW_CONFIDENCE_TRUST_RATIO = 0.45;

export function PlayerPage() {
  const params = useParams<{ gameName: string; tagLine: string }>();
  const { user } = useAuth();
  const gameName = params.gameName ?? "";
  const tagLine = params.tagLine ?? "";

  const [range, setRange] = useState<RangeKey>("ALL");
  const [hoveredPoint, setHoveredPoint] = useState<Snapshot | null>(null);

  const { playerQuery, handleRefresh, isRefreshBusy } = usePlayerData(gameName, tagLine);
  const portfolioQuery = usePortfolioQuery({ enabled: Boolean(user?.emailVerified) });

  // All hooks must run before any conditional returns.
  const history = playerQuery.data?.history ?? [];

  const trustedPointCount = useMemo(
    () =>
      history.filter(
        (point) => point.source === "confirmed" || point.source === "snapshot",
      ).length,
    [history],
  );
  const modeledPointCount = useMemo(
    () =>
      history.filter(
        (point) =>
          point.source === "confirmed" ||
          point.source === "snapshot" ||
          point.source === "estimated",
      ).length,
    [history],
  );

  const handleHover = useCallback((point: Snapshot | null) => {
    setHoveredPoint(point);
  }, []);

  useEffect(() => {
    setRange("ALL");
    setHoveredPoint(null);
  }, [gameName, tagLine]);

  useEffect(() => {
    setHoveredPoint(null);
  }, [range]);

  useDocumentTitle(
    playerQuery.data
      ? `${playerQuery.data.gameName}#${playerQuery.data.tagLine} — League of Stonks`
      : "League of Stonks",
  );

  if (playerQuery.isPending) {
    return <StatusMessage text={`Loading ${gameName}#${tagLine}...`} variant="loading" />;
  }

  if (playerQuery.isError) {
    const msg =
      playerQuery.error instanceof Error ? playerQuery.error.message : scoreErrorMessage(0);
    return <StatusMessage text={msg} variant="error" />;
  }

  if (!playerQuery.data) {
    return <StatusMessage text="No player data available." variant="error" />;
  }

  const data = playerQuery.data;
  const latest = history[history.length - 1] ?? null;

  const trustedRatio = modeledPointCount === 0 ? 1 : trustedPointCount / modeledPointCount;
  const showLowConfidenceHint =
    modeledPointCount > 0 &&
    (trustedPointCount < LOW_CONFIDENCE_TRUSTED_POINTS ||
      trustedRatio < LOW_CONFIDENCE_TRUST_RATIO);
  const confidenceHintId = `data-quality-${gameName}-${tagLine}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );

  const externalLinks = buildExternalProfileLinks({
    gameName: data.gameName,
    tagLine: data.tagLine,
  });

  return (
    <section className="player-card">
      {/* ── Full-width header row ──────────────────────── */}
      <div className="player-head">
        <div className="player-id">
          <div className="player-riot-id">
            <h2 className="player-name">{data.gameName}</h2>
            <span className="player-tag">#{data.tagLine}</span>
            {showLowConfidenceHint ? (
              <span className="data-quality-hint">
                <button
                  type="button"
                  className="data-quality-hint-btn"
                  aria-label="Data confidence info"
                  aria-describedby={confidenceHintId}
                >
                  i
                </button>
                <span id={confidenceHintId} role="tooltip" className="data-quality-tooltip">
                  This profile has limited confirmed datapoints ({trustedPointCount}/
                  {modeledPointCount}). Refresh after ranked games to improve historical
                  accuracy.
                </span>
              </span>
            ) : null}
          </div>
          {externalLinks.opgg || externalLinks.ugg ? (
            <div className="player-external-links">
              {externalLinks.opgg ? (
                <a href={externalLinks.opgg} target="_blank" rel="noopener noreferrer">
                  op.gg
                </a>
              ) : null}
              {externalLinks.ugg ? (
                <a href={externalLinks.ugg} target="_blank" rel="noopener noreferrer">
                  u.gg
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="player-head-meta">
          <span>{history.length === 1 ? "1 game" : `${history.length} games`}</span>
          {latest ? <span>Latest {formatDate(latest.recordedAt)}</span> : null}
        </div>

        <button
          className={`btn btn-ghost player-refresh ${isRefreshBusy ? "is-busy" : ""}`}
          type="button"
          onClick={() => void handleRefresh()}
          disabled={isRefreshBusy}
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
          <span className="refresh-label">{isRefreshBusy ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>

      {/* ── Two-column body ────────────────────────────── */}
      <div className="player-body">
        <PlayerChartPanel
          history={history}
          range={range}
          onRangeChange={setRange}
          onHover={handleHover}
        />
        <PlayerTradePanel
          gameName={data.gameName}
          tagLine={data.tagLine}
          history={history}
          hoveredPoint={hoveredPoint}
          range={range}
          portfolioQuery={portfolioQuery}
          user={user}
        />
      </div>
    </section>
  );
}
