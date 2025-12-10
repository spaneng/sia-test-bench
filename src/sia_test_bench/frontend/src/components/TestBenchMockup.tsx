import { useTestBenchStore } from '../store/useTestBenchStore';
import './TestBenchMockup.css';

export function TestBenchMockup() {
  const { latestData, pumpState, isRunning } = useTestBenchStore();

  const formatValue = (value: number | null | undefined, unit: string) => {
    if (value === null || value === undefined) return `-- ${unit}`;
    return `${value.toFixed(1)} ${unit}`;
  };

  const getPumpColor = () => {
    if (!isRunning) return '#9ca3af'; // gray when off
    return pumpState === 'on' ? '#10b981' : '#f59e0b'; // green when on, amber for warning_disabled
  };

  const getFlowAnimation = () => {
    return isRunning ? 'flow-animation 2s linear infinite' : 'none';
  };

  return (
    <div className="test-bench-mockup">
      <h3>Test Bench Overview</h3>
      <div className="mockup-container">
        <svg
          viewBox="0 0 800 400"
          className="test-bench-svg"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background */}
          <rect width="800" height="400" fill="#f9fafb" />

          {/* Inlet Pipe */}
          <g id="inlet-pipe">
            <rect x="50" y="180" width="150" height="40" fill="#6b7280" />
            <circle cx="200" cy="200" r="20" fill="#4b5563" />
            {/* Flow indicator */}
            {isRunning && (
              <g className="flow-indicator">
                <circle cx="100" cy="200" r="8" fill="#3b82f6" opacity="0.6">
                  <animate
                    attributeName="cx"
                    from="100"
                    to="180"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
                <circle cx="100" cy="200" r="8" fill="#3b82f6" opacity="0.4">
                  <animate
                    attributeName="cx"
                    from="100"
                    to="180"
                    dur="2s"
                    begin="0.5s"
                    repeatCount="indefinite"
                  />
                </circle>
              </g>
            )}
          </g>

          {/* Pump */}
          <g id="pump">
            <circle cx="300" cy="200" r="50" fill={getPumpColor()} stroke="#374151" strokeWidth="3" />
            <circle cx="300" cy="200" r="35" fill="#ffffff" opacity="0.3" />
            {/* Pump blades */}
            <g transform="translate(300, 200)">
              <line x1="0" y1="-25" x2="0" y2="25" stroke="#374151" strokeWidth="2" />
              <line x1="-25" y1="0" x2="25" y2="0" stroke="#374151" strokeWidth="2" />
              <line x1="-18" y1="-18" x2="18" y2="18" stroke="#374151" strokeWidth="2" />
              <line x1="18" y1="-18" x2="-18" y2="18" stroke="#374151" strokeWidth="2" />
            </g>
            {/* Pump label */}
            <text x="300" y="270" textAnchor="middle" className="component-label">
              PUMP
            </text>
            {/* Pump status */}
            <text x="300" y="290" textAnchor="middle" className="status-label" fill={getPumpColor()}>
              {pumpState.toUpperCase()}
            </text>
          </g>

          {/* Outlet Pipe */}
          <g id="outlet-pipe">
            <rect x="350" y="180" width="200" height="40" fill="#6b7280" />
            <circle cx="550" cy="200" r="20" fill="#4b5563" />
            {/* Flow indicator */}
            {isRunning && (
              <g className="flow-indicator">
                <circle cx="360" cy="200" r="8" fill="#3b82f6" opacity="0.6">
                  <animate
                    attributeName="cx"
                    from="360"
                    to="540"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
                <circle cx="360" cy="200" r="8" fill="#3b82f6" opacity="0.4">
                  <animate
                    attributeName="cx"
                    from="360"
                    to="540"
                    dur="2s"
                    begin="0.5s"
                    repeatCount="indefinite"
                  />
                </circle>
              </g>
            )}
          </g>

          {/* Pressure Sensor */}
          <g id="pressure-sensor">
            <rect x="420" y="160" width="30" height="60" fill="#3b82f6" rx="5" />
            <circle cx="435" cy="190" r="8" fill="#ffffff" />
            <text x="435" y="250" textAnchor="middle" className="sensor-label">
              PRESSURE
            </text>
            <text x="435" y="270" textAnchor="middle" className="sensor-value">
              {formatValue(latestData?.pressure, 'PSI')}
            </text>
          </g>

          {/* Flow Sensor */}
          <g id="flow-sensor">
            <rect x="480" y="160" width="30" height="60" fill="#10b981" rx="5" />
            <circle cx="495" cy="190" r="8" fill="#ffffff" />
            <text x="495" y="250" textAnchor="middle" className="sensor-label">
              FLOW
            </text>
            <text x="495" y="270" textAnchor="middle" className="sensor-value">
              {formatValue(latestData?.flowRate, 'GPM')}
            </text>
          </g>

          {/* Temperature Sensor */}
          <g id="temperature-sensor">
            <circle cx="600" cy="200" r="15" fill="#f59e0b" />
            <circle cx="600" cy="200" r="8" fill="#ffffff" />
            <text x="600" y="250" textAnchor="middle" className="sensor-label">
              TEMP
            </text>
            <text x="600" y="270" textAnchor="middle" className="sensor-value">
              {formatValue(latestData?.temperature, '°F')}
            </text>
          </g>

          {/* Power/Electrical Section */}
          <g id="power-section">
            <rect x="50" y="50" width="100" height="80" fill="#1f2937" rx="5" />
            <rect x="60" y="60" width="80" height="20" fill="#374151" rx="3" />
            <text x="100" y="75" textAnchor="middle" className="power-label" fill="#ffffff">
              POWER
            </text>
            {/* Voltage */}
            <text x="70" y="100" className="power-value" fill="#8b5cf6">
              V: {formatValue(latestData?.voltage, 'V')}
            </text>
            {/* Current */}
            <text x="70" y="120" className="power-value" fill="#ef4444">
              I: {formatValue(latestData?.current, 'A')}
            </text>
          </g>

          {/* Control Valve */}
          <g id="control-valve">
            <rect x="580" y="170" width="40" height="60" fill="#6b7280" rx="5" />
            <circle cx="600" cy="200" r="12" fill="#ffffff" />
            <line x1="600" y1="188" x2="600" y2="212" stroke="#374151" strokeWidth="3" />
            <text x="600" y="250" textAnchor="middle" className="component-label">
              VALVE
            </text>
          </g>

          {/* Outlet/Discharge */}
          <g id="discharge">
            <rect x="650" y="180" width="100" height="40" fill="#6b7280" />
            <polygon points="750,200 780,190 780,210" fill="#4b5563" />
            <text x="700" y="250" textAnchor="middle" className="component-label">
              DISCHARGE
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

