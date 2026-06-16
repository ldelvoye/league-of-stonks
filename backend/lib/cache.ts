import { logger } from "./logger.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      this.hits++;
      return cached;
    }

    const existingLoad = this.inFlight.get(key) as Promise<T> | undefined;
    if (existingLoad) {
      // Count coalesced concurrent misses as cache hits for hit-rate visibility.
      this.hits++;
      return existingLoad;
    }

    this.misses++;
    const load = fn()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, load);
    return load;
  }

  /**
   * Emits a structured log line with hit/miss counts and current size.
   * Call periodically or on-demand from an observability endpoint.
   */
  logMetrics(label: string): void {
    logger.info("Cache metrics snapshot", {
      event: "cache.metrics.snapshot",
      category: "cache",
      action: "metrics",
      outcome: "success",
      label,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses === 0
        ? null
        : Math.round((this.hits / (this.hits + this.misses)) * 100),
      size: this.store.size,
    });
  }

  /** Returns a snapshot of the current counters without side effects. */
  getMetrics(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }

  /** Removes all entries and resets counters. Primarily used in tests. */
  clear(): void {
    this.store.clear();
    this.inFlight.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
