// Game-count filters, equivalent to stock-chart period selectors.
import type { Snapshot } from "./types.js";

export type RangeKey = "10G" | "25G" | "50G" | "100G" | "S16";

export interface RangeDef {
  key: RangeKey;
  label: string;
  description: string;
  games: number;
}

// Ordered narrowest -> widest. S16 is always last. Every button is always shown,
// like a stock chart — even when history is short, wider ranges just show all
// available games.
export const RANGES: RangeDef[] = [
  { key: "10G", label: "10G", description: "Last 10 games", games: 10 },
  { key: "25G", label: "25G", description: "Last 25 games", games: 25 },
  { key: "50G", label: "50G", description: "Last 50 games", games: 50 },
  { key: "100G", label: "100G", description: "Last 100 games", games: 100 },
  { key: "S16", label: "S16", description: "Season 16 games", games: Infinity },
];

const S16_RANGE = RANGES[RANGES.length - 1];

export function rangeByKey(key: RangeKey): RangeDef {
  return RANGES.find((range) => range.key === key) ?? S16_RANGE;
}

// History arrives oldest -> newest. Count windows are measured from the newest
// game backward.
export function filterByRange(history: Snapshot[], key: RangeKey): Snapshot[] {
  const def = rangeByKey(key);
  if (history.length === 0 || !Number.isFinite(def.games)) {
    return history.slice();
  }

  const take = Math.max(1, Math.floor(def.games));
  if (history.length <= take) {
    return history.slice();
  }
  return history.slice(history.length - take);
}
