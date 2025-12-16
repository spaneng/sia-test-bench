import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface MiniLiveChartProps {
  label: string;
  data: number[];
  unit: string;
  color: string;
  latestValue: number | null | undefined;
}

export function MiniLiveChart({ label, data, unit, color, latestValue }: MiniLiveChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  // Create plot once
  useEffect(() => {
    if (!chartRef.current) return;

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 80,
      legend: {
        show: false,
      },
      axes: [
        { show: false },
        { show: false },
      ],
      series: [
        {},
        {
          stroke: color,
        },
      ],
      padding: [8, 8, 8, 8],
    };

    const recentData = data.slice(-30);

    const plotData: uPlot.AlignedData = [
      new Array(recentData.length).fill(0).map((_, i) => i),
      new Float64Array(recentData),
    ];

    plotRef.current = new uPlot(opts, plotData, chartRef.current);

    return () => {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, []);

  // Update data when it changes
  useEffect(() => {
    if (!plotRef.current) return;

    const recentData = data.slice(-30);

    const plotData: uPlot.AlignedData = [
      new Array(recentData.length).fill(0).map((_, i) => i),
      new Float64Array(recentData),
    ];

    plotRef.current.setData(plotData);
  }, [data]);

  const formatValue = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return value.toFixed(2);
  };

  return (
    <div className="mini-live-chart">
      <div className="mini-chart-header">
        <span className="mini-chart-label">{label}</span>
        <span className="mini-chart-value">
          {formatValue(latestValue)} <span className="mini-chart-unit">{unit}</span>
        </span>
      </div>
      <div className="mini-chart-canvas-wrapper" ref={chartRef} />
    </div>
  );
}
