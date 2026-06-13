import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ApiErrorBody, PortfolioTradeSide, Snapshot } from "../../lib/types";
import {
  executeTrade,
  getPortfolio,
  portfolioErrorMessage,
  getScoreAndHistory,
  scoreErrorMessage,
} from "../../lib/api";
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatShares,
  formatSignedMoney,
  toNumeric,
  trendArrow,
  trendClass,
} from "../../lib/format";
import { filterByRange, RANGES, rangeByKey, type RangeKey } from "../../lib/ranges";
import { StatusMessage } from "../components/StatusMessage";
import { StockChart } from "../components/StockChart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { buildExternalProfileLinks } from "../lib/externalProfileLinks";
import { useAuth } from "../state/AuthContext";
import { useToast } from "../state/ToastContext";

class PlayerRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(scoreErrorMessage(status));
    this.status = status;
  }
}

class PortfolioRequestError extends Error {
  readonly status: number;

  constructor(status: number, data: ApiErrorBody | null) {
    super(portfolioErrorMessage(status, data));
    this.status = status;
  }
}

const MIN_REFRESH_VISUAL_MS = 700;
const LOW_CONFIDENCE_TRUSTED_POINTS = 6;
const LOW_CONFIDENCE_TRUST_RATIO = 0.45;
const TRADE_SHARES_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;

export function normalizeSharesInput(value: string): string | null {
  const trimmed = value.trim();
  if (!TRADE_SHARES_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return trimmed;
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

function parseApiErrorBody(value: unknown): ApiErrorBody | null {
  if (!value || typeof value !== "object") return null;
  if (!("error" in value)) return null;
  return value as ApiErrorBody;
}

function portfolioErrorText(error: unknown): string {
  if (error instanceof PortfolioRequestError) return error.message;
  return "Could not load portfolio data.";
}

export function PlayerPage() {
  const navigate = useNavigate();
  const params = useParams<{ gameName: string; tagLine: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();
  const gameName = params.gameName ?? "";
  const tagLine = params.tagLine ?? "";

  const [range, setRange] = useState<RangeKey>("ALL");
  const [hoveredPoint, setHoveredPoint] = useState<Snapshot | null>(null);
  const [isRefreshUiBusy, setIsRefreshUiBusy] = useState(false);
  const [sharesInput, setSharesInput] = useState("1");
  const [tradeBusySide, setTradeBusySide] = useState<PortfolioTradeSide | null>(null);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["player", gameName, tagLine] as const, [gameName, tagLine]);

  const playerQuery = useQuery({
    queryKey,
    enabled: Boolean(gameName && tagLine),
    queryFn: async () => {
      const result = await getScoreAndHistory(gameName, tagLine, 100, { refresh: false });
      if (!result.ok || !result.data) throw new PlayerRequestError(result.status);
      return result.data;
    },
  });

  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    enabled: Boolean(user?.emailVerified),
    queryFn: async () => {
      const result = await getPortfolio();
      if (!result.ok || !result.data) {
        throw new PortfolioRequestError(result.status, parseApiErrorBody(result.data));
      }
      return result.data;
    },
  });

  const data = playerQuery.data ?? null;
  const history = data?.history ?? [];
  const visible = useMemo(() => filterByRange(history, range), [history, range]);
  const trustedPointCount = useMemo(
    () => history.filter((point) => point.source === "confirmed" || point.source === "snapshot").length,
    [history],
  );
  const modeledPointCount = useMemo(
    () => history.filter((point) => point.source === "confirmed" || point.source === "snapshot" || point.source === "estimated").length,
    [history],
  );
  const trustedRatio = modeledPointCount === 0 ? 1 : trustedPointCount / modeledPointCount;
  const showLowConfidenceHint =
    modeledPointCount > 0 &&
    (trustedPointCount < LOW_CONFIDENCE_TRUSTED_POINTS || trustedRatio < LOW_CONFIDENCE_TRUST_RATIO);
  const confidenceHintId = `data-quality-${gameName}-${tagLine}`.replace(/[^a-zA-Z0-9_-]/g, "-");

  const baseline = firstScored(visible);
  const current = hoveredPoint ?? lastScored(visible);
  const ownedPosition = useMemo(
    () =>
      portfolioQuery.data?.positions.find(
        (position) =>
          position.gameName.toLowerCase() === gameName.toLowerCase() &&
          position.tagLine.toLowerCase() === tagLine.toLowerCase(),
      ) ?? null,
    [portfolioQuery.data?.positions, gameName, tagLine],
  );
  const ownedShares = toNumeric(ownedPosition?.shares) ?? 0;
  const tradeSharesValue = normalizeSharesInput(sharesInput);
  const requestedShares = tradeSharesValue ? Number(tradeSharesValue) : null;
  const tradePriceScore = lastScored(history)?.score ?? null;
  const estimatedOrderValue =
    tradePriceScore != null && requestedShares != null ? tradePriceScore * requestedShares : null;
  const availableBalance = toNumeric(portfolioQuery.data?.lpBalance);
  const showInvalidSharesHint = sharesInput.trim().length > 0 && !tradeSharesValue;
  const buyInsufficientBalance =
    tradeSharesValue != null &&
    tradePriceScore != null &&
    availableBalance != null &&
    estimatedOrderValue != null &&
    estimatedOrderValue > availableBalance;
  const sellInsufficientShares =
    tradeSharesValue != null && requestedShares != null && requestedShares > ownedShares;
  const tradeHint = showInvalidSharesHint
    ? "Enter shares as a positive number with up to 3 decimals."
    : tradePriceScore == null
      ? "Trading is disabled while this player has no current price per share."
      : buyInsufficientBalance
        ? "Insufficient available balance for this buy order."
        : sellInsufficientShares
          ? `You can sell up to ${formatShares(ownedShares) ?? "0"} shares.`
          : null;
  const buyDisabled =
    tradeBusySide !== null ||
    !tradeSharesValue ||
    tradePriceScore == null ||
    availableBalance == null ||
    estimatedOrderValue == null ||
    estimatedOrderValue > availableBalance;
  const sellDisabled =
    tradeBusySide !== null ||
    !tradeSharesValue ||
    tradePriceScore == null ||
    requestedShares == null ||
    requestedShares > ownedShares;

  const priceLabel = hoveredPoint ? "Price per share" : "Current price per share";
  const priceContext = hoveredPoint
    ? formatDate(hoveredPoint.recordedAt)
    : rangeByKey(range).description;
  const currentPrice = current?.score == null ? "Unranked" : `${formatMoney(current.score) ?? "0.00"} LP`;

  const delta =
    baseline &&
    current &&
    baseline !== current &&
    baseline.score !== null &&
    current.score !== null
      ? current.score - baseline.score
      : null;
  const baselineScore = baseline?.score ?? null;
  const hasPercentBaseline = baselineScore !== null && baselineScore !== 0;
  const deltaText =
    delta == null
      ? null
      : hasPercentBaseline
        ? `${trendArrow(delta)} ${formatSignedMoney(delta)} LP (${formatPercent((delta / baselineScore) * 100)})`
        : `${trendArrow(delta)} ${formatSignedMoney(delta)} LP`;

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

  const handleRefresh = useCallback(async () => {
    if (isRefreshUiBusy || playerQuery.isRefetching) {
      return;
    }
    setIsRefreshUiBusy(true);
    const startedAt = Date.now();
    try {
      await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const result = await getScoreAndHistory(gameName, tagLine, 100, { refresh: true });
          if (!result.ok || !result.data) throw new PlayerRequestError(result.status);
          return result.data;
        },
      });
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_REFRESH_VISUAL_MS - elapsed);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      setIsRefreshUiBusy(false);
    }
  }, [gameName, isRefreshUiBusy, playerQuery.isRefetching, queryClient, queryKey, tagLine]);

  const handleHover = useCallback((point: Snapshot | null) => {
    setHoveredPoint(point);
  }, []);

  const handleTrade = useCallback(
    async (side: PortfolioTradeSide): Promise<void> => {
      if (!user) {
        void navigate("/login");
        return;
      }
      if (!user.emailVerified) {
        showToast("Verify your email to unlock portfolio trading.");
        void navigate("/account");
        return;
      }
      if (!data) return;
      const shares = normalizeSharesInput(sharesInput);
      if (!shares) {
        showToast("Enter a valid positive share amount (up to 3 decimals).");
        return;
      }

      setTradeBusySide(side);
      const result = await executeTrade(data.gameName, data.tagLine, side, shares);
      setTradeBusySide(null);

      if (!result.ok || !result.data) {
        const message = portfolioErrorMessage(result.status, parseApiErrorBody(result.data));
        showToast(message);
        if (result.status === 401) {
          void navigate("/login");
        }
        return;
      }

      queryClient.setQueryData(["portfolio"], result.data.portfolio);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey }),
      ]);

      const shareText = formatShares(result.data.trade.shares) ?? result.data.trade.shares;
      showToast(
        side === "buy"
          ? `Bought ${shareText} shares of ${result.data.trade.gameName}#${result.data.trade.tagLine}.`
          : `Sold ${shareText} shares of ${result.data.trade.gameName}#${result.data.trade.tagLine}.`,
      );
    },
    [user, data, sharesInput, showToast, navigate, queryClient, queryKey],
  );

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
  const isRefreshBusy = isRefreshUiBusy || playerQuery.isRefetching;
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
                  This profile has limited confirmed datapoints ({trustedPointCount}/{modeledPointCount}). Refresh
                  after ranked games to improve historical accuracy.
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
        {/* Left: chart */}
        <div className="player-chart-col">
          {hasData ? (
            <>
              <div className="range-filters" role="group" aria-label="Game range">
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
            <p className="history-empty">No game history recorded yet.</p>
          )}
        </div>

        {/* Right: price display + trade panel */}
        <div className="player-trade-col">
          {/* Price display */}
          <div className="player-price-display">
            <span className="score-label">{priceLabel}</span>
            <span className="score-value">{currentPrice}</span>
            <div className="score-trend">
              {deltaText ? (
                <span className={`score-change ${trendClass(delta ?? 0)}`}>{deltaText}</span>
              ) : null}
              <span className="score-context">{priceContext}</span>
            </div>
          </div>

          {/* Trade panel */}
          <div className="player-trade-panel">
            {!user ? (
              <p className="player-trade-message">
                <Link to="/login">Sign in</Link> to buy or sell shares for this player.
              </p>
            ) : !user.emailVerified ? (
              <p className="player-trade-message">
                Verify your email to unlock portfolio trading. <Link to="/account">Go to account</Link>
              </p>
            ) : portfolioQuery.isPending ? (
              <p className="player-trade-message">Loading your portfolio...</p>
            ) : portfolioQuery.isError ? (
              <p className="player-trade-message">{portfolioErrorText(portfolioQuery.error)}</p>
            ) : (
              <>
                <div className="player-trade-summary">
                  <span>
                    Owned: <strong>{formatShares(ownedPosition?.shares ?? "0") ?? "0"} shares</strong>
                  </span>
                  <span>
                    Balance: <strong>{formatMoney(portfolioQuery.data?.lpBalance) ?? "0.00"} LP</strong>
                  </span>
                </div>
                <div className="player-trade-controls">
                  <label className="field player-trade-field">
                    <span className="field-label">Shares</span>
                    <input
                      className="field-input player-trade-input"
                      type="text"
                      inputMode="decimal"
                      value={sharesInput}
                      onChange={(event) => setSharesInput(event.target.value)}
                      aria-label="Shares to trade"
                      placeholder="e.g. 0.25"
                    />
                    <span className="field-hint player-trade-field-hint">Up to 3 decimal places.</span>
                  </label>
                  <div className="player-trade-actions">
                    <button
                      className="btn btn-primary trade-action-buy"
                      type="button"
                      disabled={buyDisabled}
                      onClick={() => void handleTrade("buy")}
                    >
                      {tradeBusySide === "buy" ? "Buying…" : "Buy"}
                    </button>
                    <button
                      className="btn btn-ghost trade-action-sell"
                      type="button"
                      disabled={sellDisabled}
                      onClick={() => void handleTrade("sell")}
                    >
                      {tradeBusySide === "sell" ? "Selling…" : "Sell"}
                    </button>
                  </div>
                </div>
                <div className="player-trade-meta">
                  {tradeHint ? <span className="player-trade-hint">{tradeHint}</span> : null}
                  <span>
                    Est. order:{" "}
                    {estimatedOrderValue != null ? `${formatMoney(estimatedOrderValue) ?? "0.00"} LP` : "n/a"}
                  </span>
                  {ownedPosition?.unrealizedGain && ownedPosition.unrealizedGainPct ? (
                    <span className={trendClass(toNumeric(ownedPosition.unrealizedGain) ?? 0)}>
                      Position P/L:{" "}
                      {`${formatSignedMoney(toNumeric(ownedPosition.unrealizedGain) ?? 0)} LP (${formatPercent(toNumeric(ownedPosition.unrealizedGainPct) ?? 0)})`}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
