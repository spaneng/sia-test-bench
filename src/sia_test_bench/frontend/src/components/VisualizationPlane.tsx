import { useMemo } from 'react';
// import {
//   LineChart,
//   Line,
//   XAxis,
//   YAxis,
//   CartesianGrid,
//   Tooltip,
//   Legend,
//   ResponsiveContainer,
// } from 'recharts';
import { useTestBenchStore } from '../store/useTestBenchStore';
import { TestBenchMockup } from './TestBenchMockup';
import { MiniLiveChart } from './MiniLiveChart';
import { CombinedLiveChart } from './CombinedLiveChart';
import { Collapse } from './Collapse';
import './VisualizationPlane.css';

export function VisualizationPlane() {
  const { dataHistory, latestData, stateMachineState } = useTestBenchStore();

  const chartData = useMemo(() => {
    return dataHistory.map((point) => ({
      time: new Date(point.timestamp).toLocaleTimeString(),
      timestamp: point.timestamp,
      pressure: point.pressure ?? null,
      tankLevel: point.tankLevel ?? null,
      flowRate: point.flowRate ?? null,
      currentDraw: point.currentDraw ?? null,
      pulseRate: point.pulseRate ?? null,
      valveState: point.valveState ?? null,
      temperature: point.temperature ?? null,
      voltage: point.voltage ?? null,
      current: point.current ?? null,
      pumpDutyCycle: point.pumpDutyCycle ?? null,
    }));
  }, [dataHistory]);

  // Extract data arrays for mini charts
  const pressureData = useMemo(() => 
    dataHistory.map(point => point.pressure ?? 0),
    [dataHistory]
  );
  
  const flowRateUnfilteredData = useMemo(() =>
    dataHistory.map(point => point.flowRateUnfiltered ?? point.flowRate ?? 0),
    [dataHistory]
  );

  // Trailing 50-sample moving average of the raw flow signal. We compute the
  // filtered plot client-side here (rather than using the backend's filtered
  // tag value) so the visible smoothing matches what the operator sees —
  // with a rolling sum so this stays O(n) even as dataHistory grows.
  const flowRateData = useMemo(() => {
    const WINDOW = 50;
    const result: number[] = new Array(flowRateUnfilteredData.length);
    let sum = 0;
    for (let i = 0; i < flowRateUnfilteredData.length; i++) {
      sum += flowRateUnfilteredData[i];
      if (i >= WINDOW) sum -= flowRateUnfilteredData[i - WINDOW];
      const windowSize = Math.min(i + 1, WINDOW);
      result[i] = sum / windowSize;
    }
    return result;
  }, [flowRateUnfilteredData]);

  const latestFilteredFlow = flowRateData.length > 0
    ? flowRateData[flowRateData.length - 1]
    : undefined;
  
  const currentData = useMemo(() =>
    dataHistory.map(point => point.currentDraw ?? 0),
    [dataHistory]
  );
  
  const pulseRateData = useMemo(() =>
    dataHistory.map(point => point.pulseRate ?? 0),
    [dataHistory]
  );

  // Tank level rendered from the raw analogue `level_reading` (metres),
  // converted to mm for display. tankLevel (`level_filled_percentage`) is
  // derived and less useful than the raw reading here.
  const tankLevelData = useMemo(() =>
    dataHistory.map(point => (point.levelReading ?? 0) * 1000),
    [dataHistory]
  );
  const latestLevelMm = latestData?.levelReading != null
    ? latestData.levelReading * 1000
    : undefined;

  return (
    <div className="visualization-plane">
      {/* <div className="viz-header">
        <h2>Live Data Visualization</h2>
        <div className="data-status">
          <span>Data Points: {dataHistory.length}</span>
        </div>
      </div> */}

      {/* {connectionStatus !== 'connected' && (
        <div className="connection-warning">
          <p>Not connected to backend. Data visualization unavailable.</p>
        </div>
      )} */}

      {/* Mini Live Charts - Real-time visualizations */}
      <Collapse in={stateMachineState !== 'off'} timeout={300}>
        <div className="combined-chart-container">
          <CombinedLiveChart
            pressureData={pressureData}
            flowData={flowRateData}
            flowDataUnfiltered={flowRateUnfilteredData}
            latestPressure={latestData?.pressure}
            latestFlow={latestFilteredFlow}
          />
        </div>
      </Collapse>

      <div className="current-values">
          {/* <h3>Live Metrics</h3> */}
          
          {/* Collapsible pressure/flow charts - visible when state is 'off' */}
          <Collapse in={stateMachineState === 'off'} timeout={300}>
            <div className="pressure-flow-grid">
              <MiniLiveChart
                label="Pressure"
                data={pressureData}
                unit="PSI"
                color="#3b82f6"
                latestValue={latestData?.pressure}
              />
              <MiniLiveChart
                label="Flow Rate"
                data={flowRateData}
                secondaryData={flowRateUnfilteredData}
                secondaryColor="rgba(16, 185, 129, 0.35)"
                unit="L/Hr"
                color="#10b981"
                latestValue={latestFilteredFlow}
              />
            </div>
          </Collapse>
          
          {/* Static current/duty cycle charts - always visible */}
          <div className="static-charts-grid">
            <MiniLiveChart
              label="Current"
              data={currentData}
              unit="A"
              color="#ef4444"
              latestValue={latestData?.currentDraw}
            />
            <MiniLiveChart
              label="Pulse Rate"
              data={pulseRateData}
              unit="Hz"
              color="#06b6d4"
              latestValue={latestData?.pulseRate ?? 0}
            />
          </div>

          {/* Tank level mini plot — always visible so the operator can watch
              the sight-glass level regardless of which test is running. */}
          <div className="static-charts-grid">
            <MiniLiveChart
              label="Tank Level"
              data={tankLevelData}
              unit="mm"
              color="#8b5cf6"
              latestValue={latestLevelMm}
            />
          </div>
      </div>

      <div className="charts-container">
        {chartData.length > 0 ? (
          <>
            {/* <div className="chart-wrapper">
              <h3>Pressure & Flow Rate</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="pressure"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    name="Pressure (PSI)"
                  />
                  <Line
                    type="monotone"
                    dataKey="flowRate"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    name="Flow Rate (GPM)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-wrapper">
              <h3>Tank Level & Current Draw</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="tankLevel"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    name="Tank Level (%)"
                  />
                  <Line
                    type="monotone"
                    dataKey="currentDraw"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                    name="Current Draw (A)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-wrapper">
              <h3>Pulse Rate</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="pulseRate"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    name="Pulse Rate (Hz)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-wrapper">
              <h3>Temperature</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="temperature"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    name="Temperature (°F)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-wrapper">
              <h3>Voltage & Current</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="voltage"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    name="Voltage (V)"
                  />
                  <Line
                    type="monotone"
                    dataKey="current"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                    name="Current (A)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div> */}
          </>
        ) : (
          <div className="no-data">
            <p>No data available. Start the pump to begin collecting data.</p>
          </div>
        )}
      </div>

      <TestBenchMockup />
    </div>
  );
}

