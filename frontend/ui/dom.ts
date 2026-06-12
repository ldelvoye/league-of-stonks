// Central registry of the DOM elements the app touches, resolved once at load.

function getEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as unknown as T;
}

export const els = {
  searchForm: getEl<HTMLFormElement>("search-form"),
  searchInput: getEl<HTMLInputElement>("search-input"),
  message: getEl<HTMLElement>("message"),
  welcome: getEl<HTMLElement>("welcome"),
  player: getEl<HTMLElement>("player"),
  playerName: getEl<HTMLElement>("player-name"),
  playerTag: getEl<HTMLElement>("player-tag"),
  scoreLabel: getEl<HTMLElement>("score-label"),
  currentScore: getEl<HTMLElement>("current-score"),
  currentChange: getEl<HTMLElement>("current-change"),
  scoreContext: getEl<HTMLElement>("score-context"),
  refreshButton: getEl<HTMLButtonElement>("refresh-button"),
  snapshotCount: getEl<HTMLElement>("snapshot-count"),
  lastUpdated: getEl<HTMLElement>("last-updated"),
  rangeFilters: getEl<HTMLElement>("range-filters"),
  chartArea: getEl<HTMLElement>("chart-area"),
  chartSvg: getEl<SVGSVGElement>("chart-svg"),
  chartTooltip: getEl<HTMLElement>("chart-tooltip"),
  historyEmpty: getEl<HTMLElement>("history-empty"),
};
