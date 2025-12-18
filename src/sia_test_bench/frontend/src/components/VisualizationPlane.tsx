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
import './VisualizationPlane.css';

export function VisualizationPlane() {
  const { dataHistory, latestData, connectionStatus } = useTestBenchStore();

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
  
  const temperatureData = useMemo(() => 
    dataHistory.map(point => point.temperature ?? 0),
    [dataHistory]
  );
  
  const voltageData = useMemo(() => 
    dataHistory.map(point => point.voltage ?? 0),
    [dataHistory]
  );
  
  const currentData = useMemo(() => 
    dataHistory.map(point => point.current ?? 0),
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
      <div className="current-values">
        {/* <h3>Live Metrics</h3> */}
        <div className="value-grid">
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
            unit="GPM"
            color="#10b981"
            latestValue={latestData?.flowRate}
          />
          <MiniLiveChart
            label="Temperature"
            data={temperatureData}
            unit="°F"
            color="#f59e0b"
            latestValue={latestData?.temperature}
          />
          <MiniLiveChart
            label="Voltage"
            data={voltageData}
            unit="V"
            color="#8b5cf6"
            latestValue={latestData?.voltage}
          />
          <MiniLiveChart
            label="Current"
            data={currentData}
            unit="A"
            color="#ef4444"
            latestValue={latestData?.current}
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

