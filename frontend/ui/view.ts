// Presentation layer: owns the rendered player state and translates data into
// DOM updates (header, chart, range filters, messages).
import { els } from "./dom.js";
import { createChart, type ChartController } from "./chart.js";
import type { MessageVariant, PlayerHistory, Snapshot } from "../lib/types.js";
import {
  formatDate,
  formatPercent,
  formatScore,
  formatSignedScore,
  trendArrow,
  trendClass,
} from "../lib/format.js";
import { filterByRange, RANGES, rangeByKey, type RangeKey } from "../lib/ranges.js";

const state = {
  history: [] as Snapshot[],
  visible: [] as Snapshot[],
  range: "ALL" as RangeKey,
};

let chart: ChartController | null = null;

function ensureChart(): ChartController {
  if (!chart) {
    chart = createChart({
      svg: els.chartSvg,
      area: els.chartArea,
      tooltip: els.chartTooltip,
      onHover: handleHover,
    });
  }
  return chart;
}

function firstScored(points: Snapshot[]): Snapshot | null {
  return points.find((p) => p.score !== null) ?? null;
}

function lastScored(points: Snapshot[]): Snapshot | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].score !== null) return points[i];
  }
  return null;
}

// Update the big score + change figure. With no hovered point it summarises the
// selected range (stock-style "change over period"); while hovering it echoes
// the point under the cursor and its change versus the window's open.
function updateHeader(hovered: Snapshot | null): void {
  const baseline = firstScored(state.visible);
  const current = hovered ?? lastScored(state.visible);

  els.currentScore.textContent = formatScore(current?.score) ?? "Unranked";

  if (hovered) {
    els.scoreLabel.textContent = "Score";
    els.scoreContext.textContent = formatDate(hovered.recordedAt);
  } else {
    els.scoreLabel.textContent = "Current score";
    els.scoreContext.textContent = rangeByKey(state.range).description;
  }

  if (
    baseline &&
    current &&
    baseline !== current &&
    baseline.score !== null &&
    current.score !== null
  ) {
    const delta = current.score - baseline.score;
    const parts = [`${trendArrow(delta)} ${formatSignedScore(delta)}`];
    if (baseline.score !== 0) {
      parts.push(`(${formatPercent((delta / baseline.score) * 100)})`);
    }
    els.currentChange.className = `score-change ${trendClass(delta)}`;
    els.currentChange.textContent = parts.join(" ");
    els.currentChange.hidden = false;
  } else {
    els.currentChange.hidden = true;
  }
}

function handleHover(point: Snapshot | null): void {
  updateHeader(point);
}

function applyRange(key: RangeKey): void {
  state.range = key;
  state.visible = filterByRange(state.history, key);

  for (const btn of els.rangeFilters.querySelectorAll<HTMLButtonElement>(".range-btn")) {
    const active = btn.dataset.range === key;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  }

  ensureChart().setData(state.visible);
  updateHeader(null);
}

function renderRangeButtons(): void {
  els.rangeFilters.replaceChildren();
  els.rangeFilters.hidden = false;

  for (const def of RANGES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "range-btn";
    btn.dataset.range = def.key;
    btn.textContent = def.label;
    btn.setAttribute("aria-label", def.description);
    btn.addEventListener("click", () => applyRange(def.key));
    els.rangeFilters.appendChild(btn);
  }
}

export function renderPlayer(data: PlayerHistory): void {
  const history = Array.isArray(data.history) ? data.history : [];
  state.history = history;
  state.range = "ALL";

  els.playerName.textContent = data.gameName;
  els.playerTag.textContent = `#${data.tagLine}`;
  document.title = `${data.gameName}#${data.tagLine} \u2014 League of Stonks`;

  els.snapshotCount.textContent =
    history.length === 1 ? "1 snapshot" : `${history.length} snapshots`;
  const latest = history[history.length - 1] ?? null;
  els.lastUpdated.textContent = latest ? `Last recorded ${formatDate(latest.recordedAt)}` : "";

  els.welcome.hidden = true;
  els.player.hidden = false;

  const hasData = history.length > 0;
  els.historyEmpty.hidden = hasData;
  els.chartArea.hidden = !hasData;

  if (!hasData) {
    els.rangeFilters.hidden = true;
    els.currentScore.textContent = "Unranked";
    els.currentChange.hidden = true;
    els.scoreLabel.textContent = "Current score";
    els.scoreContext.textContent = "";
    return;
  }

  renderRangeButtons();
  applyRange(state.range);
}

export function showMessage(text: string, variant: MessageVariant): void {
  els.message.className = "message";
  if (variant === "error") {
    els.message.classList.add("is-error");
    els.message.textContent = text;
  } else if (variant === "loading") {
    els.message.classList.add("is-loading");
    els.message.innerHTML = "";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    const label = document.createElement("span");
    label.textContent = text;
    els.message.append(spinner, label);
  } else {
    els.message.textContent = text;
  }
  els.message.hidden = false;
}

export function clearMessage(): void {
  els.message.hidden = true;
  els.message.textContent = "";
  els.message.className = "message";
}

export function showWelcome(): void {
  els.welcome.hidden = false;
  els.player.hidden = true;
  clearMessage();
  document.title = "League of Stonks";
}

export function revealWelcome(): void {
  els.welcome.hidden = false;
}

export function hidePlayer(): void {
  els.player.hidden = true;
}

export function isPlayerHidden(): boolean {
  return Boolean(els.player.hidden);
}

export function setRefreshBusy(busy: boolean): void {
  els.refreshButton.disabled = busy;
  els.refreshButton.classList.toggle("is-busy", busy);
  const label = els.refreshButton.querySelector(".refresh-label");
  if (label) label.textContent = busy ? "Refreshing\u2026" : "Refresh";
}
