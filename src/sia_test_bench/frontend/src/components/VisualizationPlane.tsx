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
  
  const flowRateData = useMemo(() =>
    dataHistory.map(point => point.flowRate ?? 0),
    [dataHistory]
  );

  const flowRateUnfilteredData = useMemo(() =>
    dataHistory.map(point => point.flowRateUnfiltered ?? point.flowRate ?? 0),
    [dataHistory]
  );
  
  const currentData = useMemo(() =>
    dataHistory.map(point => point.currentDraw ?? 0),
    [dataHistory]
  );
  
  const pulseRateData = useMemo(() =>
    dataHistory.map(point => point.pulseRate ?? 0),
    [dataHistory]
  );

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
            latestFlow={latestData?.flowRate}
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
                latestValue={latestData?.flowRate}
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

