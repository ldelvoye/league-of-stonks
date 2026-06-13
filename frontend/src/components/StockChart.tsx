import { useEffect, useRef } from "react";
import type { Snapshot } from "../../lib/types";
import { createChart, type ChartController } from "../../ui/chart";

interface StockChartProps {
  points: Snapshot[];
  onHover?: (point: Snapshot | null) => void;
  /** Render as a minimal trend sparkline with no axes or interactivity. */
  sparkline?: boolean;
}

export function StockChart({ points, onHover, sparkline }: StockChartProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartController | null>(null);

  useEffect(() => {
    const area = areaRef.current;
    const svg = svgRef.current;
    if (!area || !svg) return;
    chartRef.current = createChart({
      area,
      svg,
      tooltip: tooltipRef.current ?? undefined,
      onHover,
      sparkline,
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [onHover, sparkline]);

  useEffect(() => {
    chartRef.current?.setData(points);
  }, [points]);

  return (
    <div className="chart-area" ref={areaRef} aria-hidden={sparkline ? "true" : undefined}>
      <svg
        className="chart-svg"
        role={sparkline ? "presentation" : "img"}
        aria-label={sparkline ? undefined : "Price per share history chart"}
        ref={svgRef}
      />
      {!sparkline && <div className="chart-tooltip" hidden ref={tooltipRef} />}
    </div>
  );
}
