import { describe, expect, it } from "vitest";

if (!("window" in globalThis)) {
  Object.defineProperty(globalThis, "window", {
    value: {
      location: {
        hostname: "localhost",
        port: "3001",
      },
    },
    configurable: true,
  });
}

const { normalizeSharesInput } = await import("../../frontend/src/routes/PlayerPage.js");

describe("normalizeSharesInput", () => {
  it("accepts positive whole shares", () => {
    expect(normalizeSharesInput("1")).toBe("1");
    expect(normalizeSharesInput("250")).toBe("250");
  });

  it("accepts positive decimal shares up to 3 places", () => {
    expect(normalizeSharesInput("0.5")).toBe("0.5");
    expect(normalizeSharesInput("1.250")).toBe("1.250");
    expect(normalizeSharesInput("  3.001  ")).toBe("3.001");
  });

  it("rejects empty, zero, and negative values", () => {
    expect(normalizeSharesInput("")).toBeNull();
    expect(normalizeSharesInput("   ")).toBeNull();
    expect(normalizeSharesInput("0")).toBeNull();
    expect(normalizeSharesInput("-1")).toBeNull();
  });

  it("rejects invalid numeric formats", () => {
    expect(normalizeSharesInput("1.1234")).toBeNull();
    expect(normalizeSharesInput("1e3")).toBeNull();
    expect(normalizeSharesInput(".5")).toBeNull();
    expect(normalizeSharesInput("abc")).toBeNull();
  });
});
