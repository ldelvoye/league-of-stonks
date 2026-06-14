import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "../../backend/lib/cache.ts";

describe("MemoryCache", () => {
  it("coalesces concurrent misses into one in-flight load", async () => {
    const cache = new MemoryCache();
    const loader = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true };
    });

    const [first, second, third] = await Promise.all([
      cache.getOrSet("market:stats", 5_000, loader),
      cache.getOrSet("market:stats", 5_000, loader),
      cache.getOrSet("market:stats", 5_000, loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(third).toEqual({ ok: true });

    const metrics = cache.getMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(2);
  });
});
