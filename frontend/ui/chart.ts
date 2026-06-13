// A dependency-free, stock-style line/area chart drawn with SVG.
//
// It positions points along the x-axis by game index (equal spacing per game),
// renders an area fill, gridlines, a baseline marker and a hover crosshair with
// a tooltip. Colour follows the trend over the visible window with a hextech
// baseline and loss-aware downtrend coloring.
//
// When opts.sparkline is true the chart renders as a minimal trend line with no
// axes, labels, grid, or interactivity — suitable for inline sparklines.
import type { Snapshot } from "../lib/types.js";
import { formatAxisDate, formatDate, formatLpInt, formatMoney } from "../lib/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const PAD = { top: 18, right: 50, bottom: 26, left: 12 };
const SPARKLINE_PAD = { top: 1, right: 1, bottom: 1, left: 1 };

const CHART_THEME = {
  lineDefault: "var(--hex-blue)",
  lineDown: "var(--down)",
  fillDefault: "var(--hex-blue)",
  fillUp: "var(--up)",
  fillDown: "var(--down)",
  grid: "var(--border)",
};

export interface ChartController {
  // Render a new set of points (range change or a freshly loaded player).
  setData(points: Snapshot[]): void;
  // Release observers/event listeners when unmounting.
  destroy(): void;
}

export interface ChartOptions {
  svg: SVGSVGElement;
  area: HTMLElement;
  /** Omit when sparkline=true; not used in sparkline mode. */
  tooltip?: HTMLElement | null;
  // Fires as the cursor moves across the chart so the header can echo the
  // hovered point, and again with null when the cursor leaves.
  onHover?: (point: Snapshot | null) => void;
  /** Render as a minimal trend line with no axes, labels, grid, or
   *  interactivity. Suitable for inline sparklines. */
  sparkline?: boolean;
}

interface Column {
  x: number;
  y: number;
  snapshot: Snapshot;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
  className?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  if (className) el.setAttribute("class", className);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

function timeOf(snapshot: Snapshot): number {
  return new Date(snapshot.recordedAt).getTime();
}

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isMixedSnapshotConfirmedTransition(previous: Snapshot, next: Snapshot): boolean {
  return (
    (previous.source === "snapshot" && next.source === "confirmed") ||
    (previous.source === "confirmed" && next.source === "snapshot")
  );
}

function inferAbnormalTransitionDelta(points: Snapshot[]): number {
  const transitions = points
    .slice(1)
    .map((next, index) => ({ previous: points[index], next }))
    .filter((pair) => pair.previous.score !== null && pair.next.score !== null);

  if (transitions.length === 0) {
    return 60;
  }

  const regularDeltas = transitions
    .filter((pair) => !isMixedSnapshotConfirmedTransition(pair.previous, pair.next))
    .map((pair) => Math.abs((pair.next.score as number) - (pair.previous.score as number)));

  const fallbackDeltas = transitions.map((pair) =>
    Math.abs((pair.next.score as number) - (pair.previous.score as number)),
  );
  const typicalDelta = median(regularDeltas) ?? median(fallbackDeltas) ?? 20;
  return Math.max(45, Math.min(140, Math.round(typicalDelta * 2.6)));
}

function isAbnormalSnapshotTransition(
  previous: Snapshot,
  next: Snapshot,
  abnormalDeltaThreshold: number,
): boolean {
  if (previous.score === null || next.score === null) {
    return false;
  }
  if (!isMixedSnapshotConfirmedTransition(previous, next)) {
    return false;
  }
  return Math.abs(next.score - previous.score) >= abnormalDeltaThreshold;
}

// Round a span to a friendly increment so gridlines land on tidy values.
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range || 1));
  const fraction = range / Math.pow(10, exponent);
  let nice: number;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exponent);
}

function niceDomain(min: number, max: number, ticks = 4): { lo: number; hi: number; step: number } {
  if (min === max) {
    const domainPad = Math.max(20, Math.abs(min) * 0.08);
    min -= domainPad;
    max += domainPad;
  }
  const step = niceNum((max - min) / Math.max(1, ticks - 1), true);
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  return { lo, hi, step };
}

export function createChart(opts: ChartOptions): ChartController {
  const { svg, area, onHover } = opts;
  const tooltip = opts.tooltip ?? null;
  const sparkline = opts.sparkline ?? false;
  const pad = sparkline ? SPARKLINE_PAD : PAD;
  const gradientId = `chart-fill-${Math.random().toString(36).slice(2, 8)}`;

  let points: Snapshot[] = [];
  let columns: Column[] = [];
  let cursorGroup: SVGGElement | null = null;
  let cursorLine: SVGLineElement | null = null;
  let cursorDot: SVGCircleElement | null = null;

  function trendOf(scored: Snapshot[]): "up" | "down" | "flat" {
    if (scored.length < 2) return "flat";
    const delta = (scored[scored.length - 1].score ?? 0) - (scored[0].score ?? 0);
    if (delta > 0) return "up";
    if (delta < 0) return "down";
    return "flat";
  }

  function redraw(): void {
    const rect = area.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width < 2 || height < 2) return;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren();
    columns = [];
    cursorGroup = null;

    const scored = points.filter((p) => p.score !== null);
    const trend = trendOf(scored);
    svg.dataset.trend = trend;
    const lineColor = trend === "down" ? CHART_THEME.lineDown : CHART_THEME.lineDefault;
    const fillColor =
      trend === "down" ? CHART_THEME.fillDown : trend === "up" ? CHART_THEME.fillUp : CHART_THEME.fillDefault;
    svg.style.setProperty("--chart-line-color", lineColor);
    svg.style.setProperty("--chart-fill-color", fillColor);
    svg.style.setProperty("--chart-grid-color", CHART_THEME.grid);

    if (scored.length === 0) {
      if (!sparkline) {
        const note = svgEl(
          "text",
          { x: width / 2, y: height / 2, "text-anchor": "middle", "dominant-baseline": "middle" },
          "chart-axis-label",
        );
        note.textContent = "No price-per-share data in this range";
        svg.appendChild(note);
      }
      return;
    }

    // Gradient for the area fill; its colour is driven from CSS via the stop
    // classes so it tracks the trend (green/red) alongside the line.
    const defs = svgEl("defs");
    const gradient = svgEl("linearGradient", { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.appendChild(svgEl("stop", { offset: "0%" }, "chart-fill-top"));
    gradient.appendChild(svgEl("stop", { offset: "100%" }, "chart-fill-bottom"));
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const scoredWithIndex = points.flatMap((snapshot, index) =>
      snapshot.score === null ? [] : [{ snapshot, index }],
    );
    const firstTime = timeOf(points[0]);
    const lastTime = timeOf(points[points.length - 1]);
    const spanDays = Math.max(0, (lastTime - firstTime) / (24 * 60 * 60 * 1000));

    const scores = scoredWithIndex.map((entry) => entry.snapshot.score as number);
    const { lo, hi, step } = niceDomain(Math.min(...scores), Math.max(...scores));

    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const bottom = pad.top + plotH;

    const xOf = (index: number): number =>
      points.length <= 1 ? pad.left + plotW / 2 : pad.left + (index / (points.length - 1)) * plotW;
    const yOf = (score: number): number =>
      hi === lo ? pad.top + plotH / 2 : pad.top + (1 - (score - lo) / (hi - lo)) * plotH;

    // --- Horizontal gridlines + price labels (right side) — full chart only ---
    if (!sparkline) {
      const grid = svgEl("g");
      for (let value = lo; value <= hi + step / 2; value += step) {
        const y = yOf(value);
        grid.appendChild(
          svgEl("line", { x1: pad.left, y1: y, x2: pad.left + plotW, y2: y }, "chart-grid"),
        );
        const label = svgEl(
          "text",
          { x: width - 4, y, "text-anchor": "end", "dominant-baseline": "middle" },
          "chart-grid-label",
        );
        label.textContent = formatLpInt(value) ?? "0";
        grid.appendChild(label);
      }
      svg.appendChild(grid);
    }

    // --- Area fill + line, split into segments so unranked gaps break cleanly ---
    const segments: Array<Array<{ snapshot: Snapshot; index: number }>> = [];
    let current: Array<{ snapshot: Snapshot; index: number }> = [];
    for (let index = 0; index < points.length; index += 1) {
      const snapshot = points[index];
      if (snapshot.score === null) {
        if (current.length) segments.push(current);
        current = [];
      } else {
        current.push({ snapshot, index });
      }
    }
    if (current.length) segments.push(current);

    const abnormalDeltaThreshold = inferAbnormalTransitionDelta(points);
    let areaData = "";
    let normalLineData = "";
    let abnormalLineData = "";
    for (const segment of segments) {
      const coords = segment.map(({ snapshot, index }) => ({
        x: xOf(index),
        y: yOf(snapshot.score as number),
        snapshot,
      }));
      if (coords.length === 1) {
        // A lone point can't form a line; show a short flat tick around it.
        const { x, y } = coords[0];
        normalLineData += `M ${x - 6} ${y} L ${x + 6} ${y} `;
      } else {
        for (let i = 1; i < coords.length; i += 1) {
          const prev = coords[i - 1];
          const next = coords[i];
          if (isAbnormalSnapshotTransition(prev.snapshot, next.snapshot, abnormalDeltaThreshold)) {
            abnormalLineData += `M ${prev.x} ${prev.y} L ${next.x} ${next.y} `;
          } else {
            normalLineData += `M ${prev.x} ${prev.y} L ${next.x} ${next.y} `;
          }
        }
        areaData += `M ${coords[0].x} ${bottom} `;
        for (const c of coords) areaData += `L ${c.x} ${c.y} `;
        areaData += `L ${coords[coords.length - 1].x} ${bottom} Z `;
      }
    }

    if (areaData) {
      svg.appendChild(
        svgEl("path", { d: areaData.trim(), fill: `url(#${gradientId})` }, "chart-area-fill"),
      );
    }

    // Baseline: the first scored value in the window — full chart only.
    if (!sparkline) {
      const baselineY = yOf(scoredWithIndex[0].snapshot.score as number);
      svg.appendChild(
        svgEl(
          "line",
          { x1: pad.left, y1: baselineY, x2: pad.left + plotW, y2: baselineY },
          "chart-baseline",
        ),
      );
    }

    if (normalLineData) {
      svg.appendChild(svgEl("path", { d: normalLineData.trim() }, "chart-line"));
    }
    if (abnormalLineData) {
      svg.appendChild(svgEl("path", { d: abnormalLineData.trim() }, "chart-line chart-line-abnormal"));
    }

    // --- X-axis date labels — full chart only ---
    if (!sparkline) {
      const axis = svgEl("g");
      const fractions = width < 520 ? [0, 1] : [0, 0.5, 1];
      const seen = new Set<number>();
      for (const f of fractions) {
        const index = Math.round((points.length - 1) * f);
        const snapshot = points[index];
        if (!snapshot || seen.has(index)) continue;
        seen.add(index);
        const x = xOf(index);
        const anchor = f === 0 ? "start" : f === 1 ? "end" : "middle";
        const label = svgEl(
          "text",
          { x, y: height - 8, "text-anchor": anchor },
          "chart-axis-label",
        );
        label.textContent = formatAxisDate(snapshot.recordedAt, spanDays);
        axis.appendChild(label);
      }
      svg.appendChild(axis);
    }

    // --- Plotted dots (hit targets for hovering) ---
    columns = scoredWithIndex.map(({ snapshot, index }) => ({
      x: xOf(index),
      y: yOf(snapshot.score as number),
      snapshot,
    }));

    // --- Hover crosshair — full chart only ---
    if (!sparkline) {
      cursorGroup = svgEl("g", { visibility: "hidden" });
      cursorLine = svgEl("line", { x1: 0, y1: pad.top, x2: 0, y2: bottom }, "chart-cursor-line");
      cursorDot = svgEl("circle", { r: 4.5, cx: 0, cy: 0 }, "chart-dot");
      cursorGroup.append(cursorLine, cursorDot);
      svg.appendChild(cursorGroup);
    }
  }

  function nearestColumn(clientX: number): Column | null {
    if (columns.length === 0) return null;
    const rect = area.getBoundingClientRect();
    const scaleX = rect.width ? area.clientWidth / rect.width : 1;
    const x = (clientX - rect.left) * scaleX;
    let best = columns[0];
    let bestDist = Math.abs(best.x - x);
    for (const column of columns) {
      const dist = Math.abs(column.x - x);
      if (dist < bestDist) {
        best = column;
        bestDist = dist;
      }
    }
    return best;
  }

  function moveCursorTo(column: Column): void {
    if (!cursorGroup || !cursorLine || !cursorDot || !tooltip) return;
    cursorGroup.setAttribute("visibility", "visible");
    cursorLine.setAttribute("x1", String(column.x));
    cursorLine.setAttribute("x2", String(column.x));
    cursorDot.setAttribute("cx", String(column.x));
    cursorDot.setAttribute("cy", String(column.y));

    tooltip.innerHTML = "";
    const date = document.createElement("div");
    date.className = "chart-tooltip-date";
    date.textContent = formatDate(column.snapshot.recordedAt);
    const price = document.createElement("div");
    price.className = "chart-tooltip-score";
    price.textContent =
      column.snapshot.score == null
        ? "Unranked"
        : `${formatMoney(column.snapshot.score) ?? "0.00"} LP`;
    tooltip.append(date, price);
    tooltip.hidden = false;

    const areaWidth = area.clientWidth;
    const ttWidth = tooltip.offsetWidth;
    const ttHeight = tooltip.offsetHeight;
    const left = Math.min(Math.max(column.x - ttWidth / 2, 4), areaWidth - ttWidth - 4);
    const top = Math.max(column.y - ttHeight - 14, 4);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideCursor(): void {
    cursorGroup?.setAttribute("visibility", "hidden");
    if (tooltip) tooltip.hidden = true;
    onHover?.(null);
  }

  function handlePointer(event: PointerEvent): void {
    const column = nearestColumn(event.clientX);
    if (!column) return;
    moveCursorTo(column);
    onHover?.(column.snapshot);
  }

  if (!sparkline) {
    area.addEventListener("pointermove", handlePointer);
    area.addEventListener("pointerdown", handlePointer);
    area.addEventListener("pointerleave", hideCursor);
  }

  const observer = new ResizeObserver(() => redraw());
  observer.observe(area);

  return {
    setData(next: Snapshot[]): void {
      points = next;
      if (tooltip) tooltip.hidden = true;
      redraw();
    },
    destroy(): void {
      observer.disconnect();
      if (!sparkline) {
        area.removeEventListener("pointermove", handlePointer);
        area.removeEventListener("pointerdown", handlePointer);
        area.removeEventListener("pointerleave", hideCursor);
      }
    },
  };
}
