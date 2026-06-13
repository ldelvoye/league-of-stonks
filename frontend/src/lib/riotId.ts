import type { RiotId } from "../../lib/types";

export function parseRiotId(raw: string): RiotId | null {
  const value = raw.trim();
  const hashIndex = value.indexOf("#");
  if (hashIndex === -1) return null;

  const gameName = value.slice(0, hashIndex).trim();
  const tagLine = value.slice(hashIndex + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

export function buildPlayerRoute(gameName: string, tagLine: string): string {
  return `/player/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
}
