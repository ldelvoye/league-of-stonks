export interface PlayerProfileDetails {
  gameName: string;
  tagLine: string;
  /** Riot platform code (e.g. na1). Defaults to na1 until region selection is added. */
  region?: string;
}

export interface ExternalProfileLinks {
  opgg: string | null;
  ugg: string | null;
}

const DEFAULT_REGION = "na1";

/** Maps Riot platform codes (e.g. na1) to external stat site region segments. */
const EXTERNAL_REGIONS: Record<string, { opgg: string; ugg: string }> = {
  na1: { opgg: "na", ugg: "na1" },
};

function resolveRegion(player: PlayerProfileDetails): string {
  return (player.region ?? DEFAULT_REGION).toLowerCase();
}

export function buildExternalProfileLinks(player: PlayerProfileDetails): ExternalProfileLinks {
  const regionKey = resolveRegion(player);
  const region = EXTERNAL_REGIONS[regionKey];
  if (!region) {
    return { opgg: null, ugg: null };
  }

  const opggSlug = `${player.gameName}-${player.tagLine}`;
  const uggSlug = `${player.gameName}-${player.tagLine}`.toLowerCase();

  return {
    opgg: `https://op.gg/lol/summoners/${region.opgg}/${encodeURIComponent(opggSlug)}`,
    ugg: `https://u.gg/lol/profile/${region.ugg}/${encodeURIComponent(uggSlug)}/overview`,
  };
}
