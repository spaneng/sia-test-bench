import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTestBenchStore } from '../store/useTestBenchStore';
import { TestBenchMockup } from './TestBenchMockup';
import './VisualizationPlane.css';

export function VisualizationPlane() {
  const { dataHistory, latestData, connectionStatus } = useTestBenchStore();

  const chartData = useMemo(() => {
    return dataHistory.map((point) => ({
      time: new Date(point.timestamp).toLocaleTimeString(),
      timestamp: point.timestamp,
      pressure: point.pressure ?? null,
      flowRate: point.flowRate ?? null,
      temperature: point.temperature ?? null,
      voltage: point.voltage ?? null,
      current: point.current ?? null,
    }));
  }, [dataHistory]);

  const formatValue = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return value.toFixed(2);
  };

  return (
    <div className="visualization-plane">
      <div className="viz-header">
        <h2>Data Visualization</h2>
        <div className="data-status">
          <span>Data Points: {dataHistory.length}</span>
        </div>
      </div>

      {connectionStatus !== 'connected' && (
        <div className="connection-warning">
          <p>Not connected to backend. Data visualization unavailable.</p>
        </div>
      )}

      {latestData && (
        <div className="current-values">
          <h3>Current Values</h3>
          <div className="value-grid">
            <div className="value-card">
              <span className="value-label">Pressure</span>
              <span className="value-number">
                {formatValue(latestData.pressure)} <span className="value-unit">PSI</span>
              </span>
            </div>
            <div className="value-card">
              <span className="value-label">Flow Rate</span>
              <span className="value-number">
                {formatValue(latestData.flowRate)} <span className="value-unit">GPM</span>
              </span>
            </div>
            <div className="value-card">
              <span className="value-label">Temperature</span>
              <span className="value-number">
                {formatValue(latestData.temperature)} <span className="value-unit">°F</span>
              </span>
            </div>
            <div className="value-card">
              <span className="value-label">Voltage</span>
              <span className="value-number">
                {formatValue(latestData.voltage)} <span className="value-unit">V</span>
              </span>
            </div>
            <div className="value-card">
              <span className="value-label">Current</span>
              <span className="value-number">
                {formatValue(latestData.current)} <span className="value-unit">A</span>
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="charts-container">
        {chartData.length > 0 ? (
          <>
            <div className="chart-wrapper">
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
            </div>
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

