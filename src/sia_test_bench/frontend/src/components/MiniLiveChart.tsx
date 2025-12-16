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
  const animationRef = useRef<number | null>(null);
  const currentPosRef = useRef<number>(0);
  const targetPosRef = useRef<number>(0);
  const animationProgressRef = useRef<number>(1);
  const previousValueRef = useRef<number | null>(null);
  const targetValueRef = useRef<number | null>(null);
  const dataRef = useRef<number[]>(data);

  // Create plot once
  useEffect(() => {
    if (!chartRef.current) return;

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 80,
      legend: {
        show: false,
      },
      scales: {
        x: {
          time: false,
          auto: false,
        },
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

    const recentData = data.slice(-300);
    const startIndex = Math.max(0, data.length - 300);

    const plotData: uPlot.AlignedData = [
      new Array(recentData.length).fill(0).map((_, i) => startIndex + i),
      new Float64Array(recentData),
    ];

    plotRef.current = new uPlot(opts, plotData, chartRef.current);

    // Initialize positions and data ref
    currentPosRef.current = data.length;
    targetPosRef.current = data.length;
    dataRef.current = data;
    
    // Set initial scale
    plotRef.current.setScale('x', {
      min: Math.max(0, data.length - 300),
      max: data.length,
    });

    // Animation loop
    const animate = () => {
      if (!plotRef.current) return;

      const diff = targetPosRef.current - currentPosRef.current;
      
      if (Math.abs(diff) > 0.01) {
        // Animate over 0.9 seconds
        currentPosRef.current += diff * 0.167;
        
        plotRef.current.setScale('x', {
          min: Math.max(0, currentPosRef.current - 300),
          max: currentPosRef.current,
        });
      }
      
      // Animate the newest point's x and y values
      if (animationProgressRef.current < 1) {
        animationProgressRef.current = Math.min(1, animationProgressRef.current + 0.167);
        
        // Update data with interpolation during animation
        if (previousValueRef.current !== null && targetValueRef.current !== null) {
          const currentData = dataRef.current;
          const recentData = currentData.slice(-300);
          const startIndex = Math.max(0, currentData.length - 300);
          
          const displayData = [...recentData];
          const displayXData: number[] = [];
          
          for (let i = 0; i < displayData.length; i++) {
            if (i === displayData.length - 1) {
              // Interpolate both x and y for the newest point
              const previousX = startIndex + i - 1;
              const targetX = startIndex + i;
              const interpolatedX = previousX + (targetX - previousX) * animationProgressRef.current;
              displayXData.push(interpolatedX);
              
              const interpolatedY = previousValueRef.current + 
                (targetValueRef.current - previousValueRef.current) * animationProgressRef.current;
              displayData[i] = interpolatedY;
            } else {
              displayXData.push(startIndex + i);
            }
          }
          
          const plotData: uPlot.AlignedData = [
            new Float64Array(displayXData),
            new Float64Array(displayData),
          ];
          
          plotRef.current.setData(plotData);
          
          // When animation completes, finalize with actual data
          if (animationProgressRef.current >= 1) {
            previousValueRef.current = null;
            targetValueRef.current = null;
          }
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, []);

  // Update data when it changes
  useEffect(() => {
    if (!plotRef.current) return;

    // Detect new data point and setup interpolation
    const isNewPoint = dataRef.current.length < data.length;
    
    if (isNewPoint && data.length >= 2) {
      // New data point - setup animation
      previousValueRef.current = data[data.length - 2];
      targetValueRef.current = data[data.length - 1];
      animationProgressRef.current = 0;
    } else {
      // Not a new point, or animation complete - update display immediately
      const recentData = data.slice(-300);
      const startIndex = Math.max(0, data.length - 300);
      
      const plotData: uPlot.AlignedData = [
        new Array(recentData.length).fill(0).map((_, i) => startIndex + i),
        new Float64Array(recentData),
      ];
      
      plotRef.current.setData(plotData);
    }
    
    // Update data ref
    dataRef.current = data;
    
    // Update target position for x-axis pan animation
    targetPosRef.current = data.length;
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