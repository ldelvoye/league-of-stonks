export const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export interface RefreshCooldown {
  allowed: boolean;
  retryAfterMs: number;
}

// Cooldown is measured from the last recorded score snapshot, not players.updated_at
// (which can change on unrelated upserts).
export function getRefreshCooldown(lastRecordedAt: Date | null): RefreshCooldown {
  if (!lastRecordedAt) {
    return { allowed: true, retryAfterMs: 0 };
  }

  const elapsed = Date.now() - lastRecordedAt.getTime();
  if (elapsed >= REFRESH_COOLDOWN_MS) {
    return { allowed: true, retryAfterMs: 0 };
  }

  return { allowed: false, retryAfterMs: REFRESH_COOLDOWN_MS - elapsed };
}

export function canRefreshPlayer(lastRecordedAt: Date | null): boolean {
  return getRefreshCooldown(lastRecordedAt).allowed;
}
