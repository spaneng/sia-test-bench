import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './CombinedLiveChart.css';

interface CombinedLiveChartProps {
  pressureData: number[];
  flowData: number[];
  latestPressure?: number;
  latestFlow?: number;
}

export function CombinedLiveChart({ 
  pressureData, 
  flowData, 
  latestPressure, 
  latestFlow 
}: CombinedLiveChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const maxDataPoints = 100;
    const displayData = pressureData.slice(-maxDataPoints);
    const displayFlowData = flowData.slice(-maxDataPoints);
    
    // Create time series data
    const timeData = displayData.map((_, i) => i);

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 300,
      scales: {
        x: {
          time: false,
        },
        pressure: {
          auto: true,
        },
        flow: {
          auto: true,
        },
      },
      series: [
        {},
        {
          label: 'Pressure (PSI)',
          stroke: '#3b82f6',
          width: 2,
          scale: 'pressure',
        },
        {
          label: 'Flow Rate (L/Hr)',
          stroke: '#10b981',
          width: 2,
          scale: 'flow',
        },
      ],
      axes: [
        {
          show: true,
          grid: { show: false },
        },
        {
          scale: 'pressure',
          side: 3,
          grid: { show: true },
          stroke: '#3b82f6',
          labelSize: 20,
        },
        {
          scale: 'flow',
          side: 1,
          grid: { show: false },
          stroke: '#10b981',
          labelSize: 20,
        },
      ],
      legend: {
        show: false,
      },
      cursor: {
        show: false,
      },
    };

    const data: uPlot.AlignedData = [
      timeData,
      displayData,
      displayFlowData,
    ];

    plotRef.current = new uPlot(opts, data, chartRef.current);

    const handleResize = () => {
      if (plotRef.current && chartRef.current) {
        plotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 300,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!plotRef.current) return;

    const maxDataPoints = 100;
    const displayData = pressureData.slice(-maxDataPoints);
    const displayFlowData = flowData.slice(-maxDataPoints);
    const timeData = displayData.map((_, i) => i);

    const data: uPlot.AlignedData = [
      timeData,
      displayData,
      displayFlowData,
    ];

    plotRef.current.setData(data);
  }, [pressureData, flowData]);

  return (
    <div className="combined-live-chart">
      <div className="combined-chart-header">
        <div className="live-value pressure">
          <span className="value-label">Pressure:</span>
          <span className="value-number">
            {latestPressure !== undefined && latestPressure !== null
              ? latestPressure.toFixed(1)
              : '--'}
          </span>
          <span className="value-unit">PSI</span>
        </div>
        <div className="live-value flow">
          <span className="value-label">Flow Rate:</span>
          <span className="value-number">
            {latestFlow !== undefined && latestFlow !== null
              ? latestFlow.toFixed(1)
              : '--'}
          </span>
          <span className="value-unit">L/Hr</span>
        </div>
      </div>
      <div ref={chartRef} className="combined-chart-container" />
    </div>
  );
}

