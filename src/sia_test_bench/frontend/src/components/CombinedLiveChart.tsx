import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

// Animation step per 60fps frame. Tuned so a full animation takes ~200ms to
// match the backend push cadence — keeps the line flowing continuously
// instead of ticking forward in discrete jumps.
const ANIM_STEP = 0.083;

interface CombinedLiveChartProps {
  pressureData: number[];
  flowData: number[];
  flowDataUnfiltered?: number[];
  latestPressure: number | null | undefined;
  latestFlow: number | null | undefined;
}

export function CombinedLiveChart({
  pressureData,
  flowData,
  flowDataUnfiltered,
  latestPressure,
  latestFlow,
}: CombinedLiveChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const animationRef = useRef<number | null>(null);
  const currentPosRef = useRef<number>(0);
  const targetPosRef = useRef<number>(0);
  const animationProgressRef = useRef<number>(1);
  const previousPressureRef = useRef<number | null>(null);
  const targetPressureRef = useRef<number | null>(null);
  const previousFlowRef = useRef<number | null>(null);
  const targetFlowRef = useRef<number | null>(null);
  const previousFlowRawRef = useRef<number | null>(null);
  const targetFlowRawRef = useRef<number | null>(null);
  const pressureDataRef = useRef<number[]>(pressureData);
  const flowDataRef = useRef<number[]>(flowData);
  const flowRawDataRef = useRef<number[]>(flowDataUnfiltered ?? []);

  // Create plot once
  useEffect(() => {
    if (!chartRef.current) return;

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 220,
      legend: {
        show: false,
      },
      scales: {
        x: {
          time: false,
          auto: false,
        },
        y: {
          auto: true,
          range: (_u, _min, max) => {
            // Ensure minimum is always 0
            const rangeMin = 0;
            // Add 10% padding at top, ensure max is at least 1 to avoid divide by zero
            const effectiveMax = Math.max(max, 1);
            const rangeMax = effectiveMax + effectiveMax * 0.1;
            return [rangeMin, rangeMax];
          },
        },
        flow: {
          auto: true,
          range: (_u, _min, max) => {
            // Ensure minimum is always 0
            const rangeMin = 0;
            // Add 10% padding at top, ensure max is at least 1 to avoid divide by zero
            const effectiveMax = Math.max(max, 1);
            const rangeMax = effectiveMax + effectiveMax * 0.1;
            return [rangeMin, rangeMax];
          },
        },
      },
      axes: [
        { show: false },
        { show: false },
      ],
      series: [
        {},
        {
          label: 'Pressure',
          stroke: '#3b82f6',
          width: 2,
          scale: 'y',
        },
        // Raw flow (pre-Kalman) sits behind the filtered line: lighter
        // translucent green, thinner stroke so noise is legible but the
        // filtered line remains the visual "truth".
        {
          label: 'Flow Rate (raw)',
          stroke: 'rgba(16, 185, 129, 0.35)',
          width: 1,
          scale: 'flow',
        },
        {
          label: 'Flow Rate',
          stroke: '#10b981',
          width: 2,
          scale: 'flow',
        },
      ],
      padding: [8, 8, 8, 8],
    };

    const recentPressure = pressureData.slice(-300);
    const recentFlow = flowData.slice(-300);
    const flowRaw = flowDataUnfiltered ?? flowData;
    const recentFlowRaw = flowRaw.slice(-300);
    const startIndex = Math.max(0, pressureData.length - 300);

    const plotData: uPlot.AlignedData = [
      new Array(recentPressure.length).fill(0).map((_, i) => startIndex + i),
      new Float64Array(recentPressure),
      new Float64Array(recentFlowRaw),
      new Float64Array(recentFlow),
    ];

    plotRef.current = new uPlot(opts, plotData, chartRef.current);

    // Initialize positions and data refs
    currentPosRef.current = pressureData.length;
    targetPosRef.current = pressureData.length;
    pressureDataRef.current = pressureData;
    flowDataRef.current = flowData;
    flowRawDataRef.current = flowDataUnfiltered ?? flowData;
    
    // Set initial scale
    plotRef.current.setScale('x', {
      min: Math.max(0, pressureData.length - 300),
      max: pressureData.length,
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
        if (previousPressureRef.current !== null && targetPressureRef.current !== null) {
          const currentPressureData = pressureDataRef.current;
          const currentFlowData = flowDataRef.current;
          const currentFlowRawData = flowRawDataRef.current;
          const recentPressure = currentPressureData.slice(-300);
          const recentFlow = currentFlowData.slice(-300);
          const recentFlowRaw = currentFlowRawData.slice(-300);
          const startIndex = Math.max(0, currentPressureData.length - 300);

          const displayPressure = [...recentPressure];
          const displayFlow = [...recentFlow];
          const displayFlowRaw = [...recentFlowRaw];
          const displayXData: number[] = [];

          for (let i = 0; i < displayPressure.length; i++) {
            if (i === displayPressure.length - 1) {
              // Interpolate both x and y for the newest point
              const previousX = startIndex + i - 1;
              const targetX = startIndex + i;
              const interpolatedX = previousX + (targetX - previousX) * animationProgressRef.current;
              displayXData.push(interpolatedX);

              if (previousPressureRef.current !== null && targetPressureRef.current !== null) {
                const interpolatedPressure = previousPressureRef.current +
                  (targetPressureRef.current - previousPressureRef.current) * animationProgressRef.current;
                displayPressure[i] = interpolatedPressure;
              }

              if (previousFlowRef.current !== null && targetFlowRef.current !== null) {
                const interpolatedFlow = previousFlowRef.current +
                  (targetFlowRef.current - previousFlowRef.current) * animationProgressRef.current;
                displayFlow[i] = interpolatedFlow;
              }

              if (previousFlowRawRef.current !== null && targetFlowRawRef.current !== null && i < displayFlowRaw.length) {
                const interpolatedFlowRaw = previousFlowRawRef.current +
                  (targetFlowRawRef.current - previousFlowRawRef.current) * animationProgressRef.current;
                displayFlowRaw[i] = interpolatedFlowRaw;
              }
            } else {
              displayXData.push(startIndex + i);
            }
          }

          const plotData: uPlot.AlignedData = [
            new Float64Array(displayXData),
            new Float64Array(displayPressure),
            new Float64Array(displayFlowRaw),
            new Float64Array(displayFlow),
          ];

          plotRef.current.setData(plotData);

          // When animation completes, finalize with actual data
          if (animationProgressRef.current >= 1) {
            previousPressureRef.current = null;
            targetPressureRef.current = null;
            previousFlowRef.current = null;
            targetFlowRef.current = null;
            previousFlowRawRef.current = null;
            targetFlowRawRef.current = null;
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
    const isNewPoint = pressureDataRef.current.length < pressureData.length;
    
    const flowRaw = flowDataUnfiltered ?? flowData;

    if (isNewPoint && pressureData.length >= 2) {
      // New data point - setup animation
      previousPressureRef.current = pressureData[pressureData.length - 2];
      targetPressureRef.current = pressureData[pressureData.length - 1];
      previousFlowRef.current = flowData[flowData.length - 2];
      targetFlowRef.current = flowData[flowData.length - 1];
      previousFlowRawRef.current = flowRaw.length >= 2 ? flowRaw[flowRaw.length - 2] : null;
      targetFlowRawRef.current = flowRaw.length >= 1 ? flowRaw[flowRaw.length - 1] : null;
      animationProgressRef.current = 0;
    } else {
      // Not a new point, or animation complete - update display immediately
      const recentPressure = pressureData.slice(-300);
      const recentFlow = flowData.slice(-300);
      const recentFlowRaw = flowRaw.slice(-300);
      const startIndex = Math.max(0, pressureData.length - 300);

      const plotData: uPlot.AlignedData = [
        new Array(recentPressure.length).fill(0).map((_, i) => startIndex + i),
        new Float64Array(recentPressure),
        new Float64Array(recentFlowRaw),
        new Float64Array(recentFlow),
      ];

      plotRef.current.setData(plotData);
    }

    // Update data refs
    pressureDataRef.current = pressureData;
    flowDataRef.current = flowData;
    flowRawDataRef.current = flowRaw;

    // Update target position for x-axis pan animation
    targetPosRef.current = pressureData.length;
  }, [pressureData, flowData, flowDataUnfiltered]);

  const formatValue = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return value.toFixed(2);
  };

  return (
    <div className="combined-live-chart">
      <div className="combined-chart-header">
        <div className="combined-chart-value left">
          <span className="combined-chart-label" style={{ color: '#3b82f6' }}>Pressure</span>
          <span className="combined-chart-number" style={{ color: '#3b82f6' }}>
            {formatValue(latestPressure)} <span className="combined-chart-unit">PSI</span>
          </span>
        </div>
        <div className="combined-chart-value right">
          <span className="combined-chart-label" style={{ color: '#10b981' }}>Flow Rate</span>
          <span className="combined-chart-number" style={{ color: '#10b981' }}>
            {formatValue(latestFlow)} <span className="combined-chart-unit">L/Hr</span>
          </span>
        </div>
      </div>
      <div className="combined-chart-canvas-wrapper" ref={chartRef} />
    </div>
  );
}

