import { useMemo } from "react";
import type { Snapshot } from "../../lib/types.js";
import { filterByRange, RANGES, type RangeKey } from "../../lib/ranges.js";
import { StockChart } from "./StockChart.js";

interface PlayerChartPanelProps {
  history: Snapshot[];
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  onHover: (point: Snapshot | null) => void;
}

export function PlayerChartPanel({ history, range, onRangeChange, onHover }: PlayerChartPanelProps) {
  const visible = useMemo(() => filterByRange(history, range), [history, range]);
  const hasData = history.length > 0;

  return (
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
                onClick={() => onRangeChange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <StockChart points={visible} onHover={onHover} />
        </>
      ) : (
        <p className="history-empty">No game history recorded yet.</p>
      )}
    </div>
  );
}
