// A dependency-free, stock-style line/area chart drawn with SVG.
//
// It positions points along the x-axis by time (so irregular snapshot spacing
// reads correctly) and renders an area fill, gridlines, a baseline marker and a
// hover crosshair with a tooltip. Colour follows the trend over the visible
// window: green when up, red when down.
import type { Snapshot } from "../lib/types.js";
import { formatAxisDate, formatDate, formatScore } from "../lib/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DAY = 24 * 60 * 60 * 1000;

const PAD = { top: 18, right: 50, bottom: 26, left: 12 };

export interface ChartController {
  // Render a new set of points (range change or a freshly loaded player).
  setData(points: Snapshot[]): void;
  // Release observers/event listeners when unmounting.
  destroy(): void;
}

export interface ChartOptions {
  svg: SVGSVGElement;
  area: HTMLElement;
  tooltip: HTMLElement;
  // Fires as the cursor moves across the chart so the header can echo the
  // hovered point, and again with null when the cursor leaves.
  onHover?: (point: Snapshot | null) => void;
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
    const pad = Math.max(20, Math.abs(min) * 0.08);
    min -= pad;
    max += pad;
  }
  const step = niceNum((max - min) / Math.max(1, ticks - 1), true);
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  return { lo, hi, step };
}

export function createChart(opts: ChartOptions): ChartController {
  const { svg, area, tooltip, onHover } = opts;

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
    svg.dataset.trend = trendOf(scored);

    if (scored.length === 0) {
      const note = svgEl(
        "text",
        { x: width / 2, y: height / 2, "text-anchor": "middle", "dominant-baseline": "middle" },
        "chart-axis-label",
      );
      note.textContent = "No ranked score in this range";
      svg.appendChild(note);
      return;
    }

    // Gradient for the area fill; its colour is driven from CSS via the stop
    // classes so it tracks the trend (green/red) alongside the line.
    const defs = svgEl("defs");
    const gradient = svgEl("linearGradient", { id: "chart-fill", x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.appendChild(svgEl("stop", { offset: "0%" }, "chart-fill-top"));
    gradient.appendChild(svgEl("stop", { offset: "100%" }, "chart-fill-bottom"));
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const times = points.map(timeOf);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const spanDays = (tMax - tMin) / DAY;

    const scores = scored.map((p) => p.score as number);
    const { lo, hi, step } = niceDomain(Math.min(...scores), Math.max(...scores));

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const bottom = PAD.top + plotH;

    const xOf = (t: number): number =>
      tMax === tMin ? PAD.left + plotW / 2 : PAD.left + ((t - tMin) / (tMax - tMin)) * plotW;
    const yOf = (score: number): number =>
      hi === lo ? PAD.top + plotH / 2 : PAD.top + (1 - (score - lo) / (hi - lo)) * plotH;

    // --- Horizontal gridlines + score labels (right side) ---
    const grid = svgEl("g");
    for (let value = lo; value <= hi + step / 2; value += step) {
      const y = yOf(value);
      grid.appendChild(
        svgEl("line", { x1: PAD.left, y1: y, x2: PAD.left + plotW, y2: y }, "chart-grid"),
      );
      const label = svgEl(
        "text",
        { x: width - PAD.right + 8, y, "dominant-baseline": "middle" },
        "chart-grid-label",
      );
      label.textContent = formatScore(value);
      grid.appendChild(label);
    }
    svg.appendChild(grid);

    // --- Area fill + line, split into segments so unranked gaps break cleanly ---
    const segments: Snapshot[][] = [];
    let current: Snapshot[] = [];
    for (const snapshot of points) {
      if (snapshot.score === null) {
        if (current.length) segments.push(current);
        current = [];
      } else {
        current.push(snapshot);
      }
    }
    if (current.length) segments.push(current);

    let areaData = "";
    let lineData = "";
    for (const segment of segments) {
      const coords = segment.map((s) => ({ x: xOf(timeOf(s)), y: yOf(s.score as number) }));
      if (coords.length === 1) {
        // A lone point can't form a line; show a short flat tick around it.
        const { x, y } = coords[0];
        lineData += `M ${x - 6} ${y} L ${x + 6} ${y} `;
      } else {
        lineData += `M ${coords[0].x} ${coords[0].y} `;
        for (let i = 1; i < coords.length; i++) lineData += `L ${coords[i].x} ${coords[i].y} `;
        areaData += `M ${coords[0].x} ${bottom} `;
        for (const c of coords) areaData += `L ${c.x} ${c.y} `;
        areaData += `L ${coords[coords.length - 1].x} ${bottom} Z `;
      }
    }

    if (areaData) {
      svg.appendChild(svgEl("path", { d: areaData.trim() }, "chart-area-fill"));
    }

    // Baseline: the first scored value in the window, like a stock's "open".
    const baselineY = yOf(scored[0].score as number);
    svg.appendChild(
      svgEl(
        "line",
        { x1: PAD.left, y1: baselineY, x2: PAD.left + plotW, y2: baselineY },
        "chart-baseline",
      ),
    );

    if (lineData) {
      svg.appendChild(svgEl("path", { d: lineData.trim() }, "chart-line"));
    }

    // --- X-axis date labels (start / middle / end) ---
    const axis = svgEl("g");
    const fractions = width < 520 ? [0, 1] : [0, 0.5, 1];
    const seen = new Set<number>();
    for (const f of fractions) {
      const t = tMin + (tMax - tMin) * f;
      const x = xOf(t);
      if (seen.has(Math.round(x))) continue;
      seen.add(Math.round(x));
      const anchor = f === 0 ? "start" : f === 1 ? "end" : "middle";
      const label = svgEl(
        "text",
        { x, y: height - 8, "text-anchor": anchor },
        "chart-axis-label",
      );
      label.textContent = formatAxisDate(new Date(t).toISOString(), spanDays);
      axis.appendChild(label);
    }
    svg.appendChild(axis);

    // --- Plotted dots (also the hit targets for hovering) ---
    columns = scored.map((snapshot) => ({
      x: xOf(timeOf(snapshot)),
      y: yOf(snapshot.score as number),
      snapshot,
    }));

    // --- Hover crosshair (hidden until the cursor enters) ---
    cursorGroup = svgEl("g", { visibility: "hidden" });
    cursorLine = svgEl("line", { x1: 0, y1: PAD.top, x2: 0, y2: bottom }, "chart-cursor-line");
    cursorDot = svgEl("circle", { r: 4.5, cx: 0, cy: 0 }, "chart-dot");
    cursorGroup.append(cursorLine, cursorDot);
    svg.appendChild(cursorGroup);
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
    if (!cursorGroup || !cursorLine || !cursorDot) return;
    cursorGroup.setAttribute("visibility", "visible");
    cursorLine.setAttribute("x1", String(column.x));
    cursorLine.setAttribute("x2", String(column.x));
    cursorDot.setAttribute("cx", String(column.x));
    cursorDot.setAttribute("cy", String(column.y));

    tooltip.innerHTML = "";
    const date = document.createElement("div");
    date.className = "chart-tooltip-date";
    date.textContent = formatDate(column.snapshot.recordedAt);
    const score = document.createElement("div");
    score.className = "chart-tooltip-score";
    score.textContent = formatScore(column.snapshot.score) ?? "Unranked";
    tooltip.append(date, score);
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
    tooltip.hidden = true;
    onHover?.(null);
  }

  function handlePointer(event: PointerEvent): void {
    const column = nearestColumn(event.clientX);
    if (!column) return;
    moveCursorTo(column);
    onHover?.(column.snapshot);
  }

  area.addEventListener("pointermove", handlePointer);
  area.addEventListener("pointerdown", handlePointer);
  area.addEventListener("pointerleave", hideCursor);

  const observer = new ResizeObserver(() => redraw());
  observer.observe(area);

  return {
    setData(next: Snapshot[]): void {
      points = next;
      tooltip.hidden = true;
      redraw();
    },
    destroy(): void {
      observer.disconnect();
      area.removeEventListener("pointermove", handlePointer);
      area.removeEventListener("pointerdown", handlePointer);
      area.removeEventListener("pointerleave", hideCursor);
    },
  };
}
