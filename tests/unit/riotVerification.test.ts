import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RIOT_VERIFICATION_PATH = join(process.cwd(), "frontend/public/riot.txt");

describe("riot.txt verification token", () => {
  it("lives in the Vite public folder for static hosting at /riot.txt", () => {
    const token = readFileSync(RIOT_VERIFICATION_PATH, "utf8").trim();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
