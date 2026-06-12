// Time-range filters, the equivalent of the period selectors on a stock chart.
import type { Snapshot } from "./types.js";

export type RangeKey = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

export interface RangeDef {
  key: RangeKey;
  label: string;
  description: string;
  ms: number;
}

const DAY = 24 * 60 * 60 * 1000;

// Ordered narrowest -> widest. ALL is always last. Every button is always shown,
// like a stock chart — even when history is short, wider ranges just show all
// available snapshots.
export const RANGES: RangeDef[] = [
  { key: "1D", label: "1D", description: "Past day", ms: DAY },
  { key: "1W", label: "1W", description: "Past week", ms: 7 * DAY },
  { key: "1M", label: "1M", description: "Past month", ms: 30 * DAY },
  { key: "3M", label: "3M", description: "Past 3 months", ms: 90 * DAY },
  { key: "1Y", label: "1Y", description: "Past year", ms: 365 * DAY },
  { key: "ALL", label: "All", description: "All time", ms: Infinity },
];

const ALL_RANGE = RANGES[RANGES.length - 1];

function timeOf(snapshot: Snapshot): number {
  return new Date(snapshot.recordedAt).getTime();
}

export function rangeByKey(key: RangeKey): RangeDef {
  return RANGES.find((range) => range.key === key) ?? ALL_RANGE;
}

// History arrives oldest -> newest. The window is measured back from the most
// recent snapshot, just like a stock chart anchors to "now".
export function filterByRange(history: Snapshot[], key: RangeKey): Snapshot[] {
  const def = rangeByKey(key);
  if (history.length === 0 || !Number.isFinite(def.ms)) {
    return history.slice();
  }

  const latest = timeOf(history[history.length - 1]);
  const cutoff = latest - def.ms;
  return history.filter((snapshot) => timeOf(snapshot) >= cutoff);
}
