import { useEffect, useRef } from "react";
import type { Snapshot } from "../../lib/types";
import { createChart, type ChartController } from "../../ui/chart";

interface StockChartProps {
  points: Snapshot[];
  onHover?: (point: Snapshot | null) => void;
}

export function StockChart({ points, onHover }: StockChartProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartController | null>(null);

  useEffect(() => {
    const area = areaRef.current;
    const svg = svgRef.current;
    const tooltip = tooltipRef.current;
    if (!area || !svg || !tooltip) return;
    chartRef.current = createChart({ area, svg, tooltip, onHover });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [onHover]);

  useEffect(() => {
    chartRef.current?.setData(points);
  }, [points]);

  return (
    <div className="chart-area" ref={areaRef}>
      <svg className="chart-svg" role="img" aria-label="Price per share history chart" ref={svgRef} />
      <div className="chart-tooltip" hidden ref={tooltipRef} />
    </div>
  );
}
