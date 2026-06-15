// Pure formatting helpers shared by the view and chart.

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Compact label used along the chart's time axis. The format scales with how
// much time the visible window spans.
export function formatAxisDate(iso: string, spanDays: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (spanDays > 300) {
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  if (spanDays > 2) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

export function formatScore(score: number | null | undefined): string | null {
  return score == null ? null : score.toLocaleString();
}

export function toNumeric(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoney(value: number | string | null | undefined): string | null {
  const numeric = toNumeric(value);
  if (numeric == null) return null;
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Canonical price-per-share string for trade API payloads (matches backend rounding). */
export function toPricePerShareString(score: number): string {
  return score.toFixed(2);
}

// LP is always an integer — use this for chart axis labels where space is tight.
export function formatLpInt(value: number | string | null | undefined): string | null {
  const numeric = toNumeric(value);
  if (numeric == null) return null;
  return Math.round(numeric).toLocaleString();
}

export function formatShares(value: number | string | null | undefined): string | null {
  const numeric = toNumeric(value);
  if (numeric == null) return null;
  if (numeric === 0) return "0";
  return numeric
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function formatSignedMoney(delta: number): string {
  const magnitude = Math.abs(delta).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (delta > 0) return `+${magnitude}`;
  if (delta < 0) return `\u2212${magnitude}`;
  return magnitude;
}

export function formatSignedScore(delta: number): string {
  const magnitude = Math.abs(delta).toLocaleString();
  if (delta > 0) return `+${magnitude}`;
  if (delta < 0) return `\u2212${magnitude}`;
  return magnitude;
}

export function formatPercent(pct: number): string {
  const magnitude = `${Math.abs(pct).toFixed(2)}%`;
  if (pct > 0) return `+${magnitude}`;
  if (pct < 0) return `\u2212${magnitude}`;
  return magnitude;
}

export function trendClass(delta: number): string {
  if (delta > 0) return "change-up";
  if (delta < 0) return "change-down";
  return "change-flat";
}

export function trendArrow(delta: number): string {
  if (delta > 0) return "\u25B2";
  if (delta < 0) return "\u25BC";
  return "\u2014";
}
