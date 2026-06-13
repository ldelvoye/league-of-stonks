export const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
export const PROFILE_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

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

export function getProfileChangeCooldown(lastChangedAt: Date | null): RefreshCooldown {
  if (!lastChangedAt) {
    return { allowed: true, retryAfterMs: 0 };
  }

  const elapsed = Date.now() - lastChangedAt.getTime();
  if (elapsed >= PROFILE_CHANGE_COOLDOWN_MS) {
    return { allowed: true, retryAfterMs: 0 };
  }

  return { allowed: false, retryAfterMs: PROFILE_CHANGE_COOLDOWN_MS - elapsed };
}

export function formatRetryAfter(retryAfterMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
