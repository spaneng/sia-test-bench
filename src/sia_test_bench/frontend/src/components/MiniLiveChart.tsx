import { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip
);

interface MiniLiveChartProps {
  label: string;
  data: number[];
  unit: string;
  color: string;
  latestValue: number | null | undefined;
}

export function MiniLiveChart({ label, data, unit, color, latestValue }: MiniLiveChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);

  // Keep only the last 30 points for the mini chart
  const recentData = data.slice(-30);
  
  // Create labels (just indices for mini chart)
  const labels = recentData.map((_, index) => index.toString());

  const chartData = {
    labels,
    datasets: [
      {
        data: recentData,
        borderColor: color,
        backgroundColor: `${color}33`, // Add transparency (20%)
        borderWidth: 2,
        fill: true,
        tension: 0.4, // Smooth curves
        pointRadius: 0, // Hide points for cleaner look
        pointHoverRadius: 0,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false, // Disable tooltips for cleaner mini chart
      },
    },
    scales: {
      x: {
        display: false, // Hide x-axis
      },
      y: {
        display: false, // Hide y-axis
        beginAtZero: false,
      },
    },
    animation: {
      duration: 300, // Quick animations for live feel
    },
    interaction: {
      intersect: false,
      mode: 'index',
    },
  };

  // Update chart when data changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.update('none'); // Update without animation for smooth real-time updates
    }
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
      <div className="mini-chart-canvas-wrapper">
        <Line ref={chartRef} data={chartData} options={options} />
      </div>
    </div>
  );
}

