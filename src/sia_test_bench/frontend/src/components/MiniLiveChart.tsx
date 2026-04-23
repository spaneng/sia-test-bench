import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

// Animation step per 60fps frame. Tuned so a full animation takes ~200ms to
// match the backend push cadence — keeps the line flowing continuously
// instead of ticking forward in discrete jumps.
const ANIM_STEP = 0.083;

interface MiniLiveChartProps {
  label: string;
  data: number[];
  unit: string;
  color: string;
  latestValue: number | null | undefined;
  // Optional secondary series (e.g. raw / unfiltered flow rate). Plotted as a
  // lighter thinner line behind the primary series. Header still shows only
  // `latestValue` (the primary/filtered value).
  secondaryData?: number[];
  secondaryColor?: string;
}

export function MiniLiveChart({
  label,
  data,
  unit,
  color,
  latestValue,
  secondaryData,
  secondaryColor,
}: MiniLiveChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const animationRef = useRef<number | null>(null);
  const currentPosRef = useRef<number>(0);
  const targetPosRef = useRef<number>(0);
  const animationProgressRef = useRef<number>(1);
  const previousValueRef = useRef<number | null>(null);
  const targetValueRef = useRef<number | null>(null);
  const previousSecondaryRef = useRef<number | null>(null);
  const targetSecondaryRef = useRef<number | null>(null);
  const dataRef = useRef<number[]>(data);
  const secondaryDataRef = useRef<number[]>(secondaryData ?? []);
  const hasSecondary = !!secondaryData;

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
        // Secondary series (optional — raw/unfiltered) rendered behind the
        // primary line as a lighter, thinner stroke.
        ...(hasSecondary ? [{
          stroke: secondaryColor ?? 'rgba(100, 116, 139, 0.45)',
          width: 1,
        }] : []),
        {
          stroke: color,
        },
      ],
      padding: [8, 8, 8, 8],
    };

    const recentData = data.slice(-300);
    const secondary = secondaryData ?? [];
    const recentSecondary = secondary.slice(-300);
    const startIndex = Math.max(0, data.length - 300);

    const plotData: uPlot.AlignedData = hasSecondary
      ? [
          new Array(recentData.length).fill(0).map((_, i) => startIndex + i),
          new Float64Array(recentSecondary),
          new Float64Array(recentData),
        ]
      : [
          new Array(recentData.length).fill(0).map((_, i) => startIndex + i),
          new Float64Array(recentData),
        ];

    plotRef.current = new uPlot(opts, plotData, chartRef.current);

    // Initialize positions and data ref
    currentPosRef.current = data.length;
    targetPosRef.current = data.length;
    dataRef.current = data;
    secondaryDataRef.current = secondary;
    
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
        currentPosRef.current += diff * ANIM_STEP;

        plotRef.current.setScale('x', {
          min: Math.max(0, currentPosRef.current - 300),
          max: currentPosRef.current,
        });
      }

      // Animate the newest point's x and y values
      if (animationProgressRef.current < 1) {
        animationProgressRef.current = Math.min(1, animationProgressRef.current + ANIM_STEP);

        // Update data with interpolation during animation
        if (previousValueRef.current !== null && targetValueRef.current !== null) {
          const currentData = dataRef.current;
          const currentSecondary = secondaryDataRef.current;
          const recentData = currentData.slice(-300);
          const recentSecondary = currentSecondary.slice(-300);
          const startIndex = Math.max(0, currentData.length - 300);

          const displayData = [...recentData];
          const displaySecondary = [...recentSecondary];
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

              if (hasSecondary && previousSecondaryRef.current !== null && targetSecondaryRef.current !== null && i < displaySecondary.length) {
                const interpolatedSecondary = previousSecondaryRef.current +
                  (targetSecondaryRef.current - previousSecondaryRef.current) * animationProgressRef.current;
                displaySecondary[i] = interpolatedSecondary;
              }
            } else {
              displayXData.push(startIndex + i);
            }
          }

          const plotData: uPlot.AlignedData = hasSecondary
            ? [
                new Float64Array(displayXData),
                new Float64Array(displaySecondary),
                new Float64Array(displayData),
              ]
            : [
                new Float64Array(displayXData),
                new Float64Array(displayData),
              ];

          plotRef.current.setData(plotData);

          // When animation completes, finalize with actual data
          if (animationProgressRef.current >= 1) {
            previousValueRef.current = null;
            targetValueRef.current = null;
            previousSecondaryRef.current = null;
            targetSecondaryRef.current = null;
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
    
    const secondary = secondaryData ?? [];

    if (isNewPoint && data.length >= 2) {
      // New data point - setup animation
      previousValueRef.current = data[data.length - 2];
      targetValueRef.current = data[data.length - 1];
      previousSecondaryRef.current = secondary.length >= 2 ? secondary[secondary.length - 2] : null;
      targetSecondaryRef.current = secondary.length >= 1 ? secondary[secondary.length - 1] : null;
      animationProgressRef.current = 0;
    } else {
      // Not a new point, or animation complete - update display immediately
      const recentData = data.slice(-300);
      const recentSecondary = secondary.slice(-300);
      const startIndex = Math.max(0, data.length - 300);

      const plotData: uPlot.AlignedData = hasSecondary
        ? [
            new Array(recentData.length).fill(0).map((_, i) => startIndex + i),
            new Float64Array(recentSecondary),
            new Float64Array(recentData),
          ]
        : [
            new Array(recentData.length).fill(0).map((_, i) => startIndex + i),
            new Float64Array(recentData),
          ];

      plotRef.current.setData(plotData);
    }

    // Update data refs
    dataRef.current = data;
    secondaryDataRef.current = secondary;

    // Update target position for x-axis pan animation
    targetPosRef.current = data.length;
  }, [data, secondaryData, hasSecondary]);

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