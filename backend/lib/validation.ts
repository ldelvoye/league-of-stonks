export function parseBoundedPositiveIntQuery(
  value: unknown,
  fallback: number,
  max: number,
): number | null {
  if (value == null) return fallback;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}
