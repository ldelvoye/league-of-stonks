const TRADE_SHARES_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;

/**
 * Validates and normalizes a trade shares string entered by the user.
 * Returns the trimmed value when valid, or null if the input is invalid or
 * non-positive.
 */
export function normalizeSharesInput(value: string): string | null {
  const trimmed = value.trim();
  if (!TRADE_SHARES_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return trimmed;
}
