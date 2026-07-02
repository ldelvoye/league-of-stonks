import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import type { AuthUser, PortfolioSnapshot, PortfolioTradeSide, Snapshot } from "../../../../lib/types.js";
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatShares,
  formatSignedMoney,
  toNumeric,
  toPricePerShareString,
  trendArrow,
  trendClass,
} from "../../../../lib/format.js";
import { filterByRange, rangeByKey, type RangeKey } from "../../../../lib/ranges.js";
import { normalizeSharesInput } from "../../../lib/tradeInput.js";
import { useExecuteTrade } from "../hooks/useExecuteTrade.js";

function firstScored(points: Snapshot[]): Snapshot | null {
  return points.find((point) => point.score !== null) ?? null;
}

function lastScored(points: Snapshot[]): Snapshot | null {
  for (let index = points.length - 1; index >= 0; index--) {
    if (points[index].score !== null) return points[index];
  }
  return null;
}

interface PlayerTradePanelProps {
  gameName: string;
  tagLine: string;
  /** Full unfiltered history used for trading price and range slicing. */
  history: Snapshot[];
  hoveredPoint: Snapshot | null;
  range: RangeKey;
  portfolioQuery: UseQueryResult<PortfolioSnapshot>;
  user: AuthUser | null;
}

export function PlayerTradePanel({
  gameName,
  tagLine,
  history,
  hoveredPoint,
  range,
  portfolioQuery,
  user,
}: PlayerTradePanelProps) {
  const [sharesInput, setSharesInput] = useState("1");
  const { handleTrade, tradeBusySide } = useExecuteTrade({ gameName, tagLine, user });

  // Range-filtered view drives the price display delta (same as the chart).
  const visible = useMemo(() => filterByRange(history, range), [history, range]);

  const baseline = firstScored(visible);
  const current = hoveredPoint ?? lastScored(visible);

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

  const priceLabel = hoveredPoint ? "Price per share" : "Current price per share";
  const priceContext = hoveredPoint
    ? formatDate(hoveredPoint.recordedAt)
    : rangeByKey(range).description;
  const currentPrice =
    current?.score == null ? "Unranked" : `${formatMoney(current.score) ?? "0.00"} LP`;

  // Trades always execute at the actual latest price, regardless of range.
  const tradePriceScore = lastScored(history)?.score ?? null;

  const ownedPosition = useMemo(
    () =>
      portfolioQuery.data?.positions.find(
        (pos) =>
          pos.gameName.toLowerCase() === gameName.toLowerCase() &&
          pos.tagLine.toLowerCase() === tagLine.toLowerCase(),
      ) ?? null,
    [portfolioQuery.data?.positions, gameName, tagLine],
  );

  const ownedShares = toNumeric(ownedPosition?.shares) ?? 0;
  const tradeSharesValue = normalizeSharesInput(sharesInput);
  const requestedShares = tradeSharesValue ? Number(tradeSharesValue) : null;
  const estimatedOrderValue =
    tradePriceScore != null && requestedShares != null ? tradePriceScore * requestedShares : null;
  const availableBalance = toNumeric(portfolioQuery.data?.lpBalance);

  const showInvalidSharesHint = sharesInput.trim().length > 0 && !tradeSharesValue;
  // A player worth 0 LP has a price per share of 0, so buys are free and can
  // never be filled meaningfully. Selling remains allowed so holders can exit.
  const priceIsZero = tradePriceScore != null && tradePriceScore <= 0;
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
      : priceIsZero
        ? "This player is worth 0 LP and can't be bought right now."
        : buyInsufficientBalance
          ? "Insufficient available balance for this buy order."
          : sellInsufficientShares
            ? `You can sell up to ${formatShares(ownedShares) ?? "0"} shares.`
            : null;

  const buyDisabled =
    tradeBusySide !== null ||
    !tradeSharesValue ||
    tradePriceScore == null ||
    priceIsZero ||
    availableBalance == null ||
    estimatedOrderValue == null ||
    estimatedOrderValue > availableBalance;

  const sellDisabled =
    tradeBusySide !== null ||
    !tradeSharesValue ||
    tradePriceScore == null ||
    requestedShares == null ||
    requestedShares > ownedShares;

  const onTrade = (side: PortfolioTradeSide) => {
    const shares = normalizeSharesInput(sharesInput);
    if (!shares || tradePriceScore == null) return;
    if (side === "buy" && tradePriceScore <= 0) return;
    void handleTrade(side, shares, toPricePerShareString(tradePriceScore));
  };

  return (
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
            Verify your email to unlock portfolio trading.{" "}
            <Link to="/account">Go to account</Link>
          </p>
        ) : portfolioQuery.isPending ? (
          <p className="player-trade-message">Loading your portfolio...</p>
        ) : portfolioQuery.isError ? (
          <p className="player-trade-message">
            {portfolioQuery.error instanceof Error
              ? portfolioQuery.error.message
              : "Could not load portfolio data."}
          </p>
        ) : (
          <>
            <div className="player-trade-summary">
              <span>
                Owned:{" "}
                <strong>{formatShares(ownedPosition?.shares ?? "0") ?? "0"} shares</strong>
              </span>
              <span>
                Balance:{" "}
                <strong>{formatMoney(portfolioQuery.data?.lpBalance) ?? "0.00"} LP</strong>
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
                <span className="field-hint player-trade-field-hint">
                  Up to 3 decimal places.
                </span>
              </label>
              <div className="player-trade-actions">
                <button
                  className="btn btn-primary trade-action-buy"
                  type="button"
                  disabled={buyDisabled}
                  onClick={() => onTrade("buy")}
                >
                  {tradeBusySide === "buy" ? "Buying…" : "Buy"}
                </button>
                <button
                  className="btn btn-ghost trade-action-sell"
                  type="button"
                  disabled={sellDisabled}
                  onClick={() => onTrade("sell")}
                >
                  {tradeBusySide === "sell" ? "Selling…" : "Sell"}
                </button>
              </div>
            </div>
            <div className="player-trade-meta">
              {tradeHint ? <span className="player-trade-hint">{tradeHint}</span> : null}
              <span>
                Est. order:{" "}
                {estimatedOrderValue != null
                  ? `${formatMoney(estimatedOrderValue) ?? "0.00"} LP`
                  : "n/a"}
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
  );
}
