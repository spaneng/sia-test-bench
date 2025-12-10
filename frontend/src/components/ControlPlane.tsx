import { useTestBenchStore } from '../store/useTestBenchStore';
import './ControlPlane.css';

export function ControlPlane() {
  const {
    pumpState,
    isRunning,
    connectionStatus,
    startPump,
    stopPump,
    setWarningDisabled,
    setWarningEnabled,
    clearData,
  } = useTestBenchStore();

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return '#10b981'; // green
      case 'connecting':
        return '#f59e0b'; // amber
      case 'error':
        return '#ef4444'; // red
      default:
        return '#6b7280'; // gray
    }
  };

  const getPumpStateColor = () => {
    switch (pumpState) {
      case 'on':
        return '#10b981'; // green
      case 'off':
        return '#6b7280'; // gray
      case 'warning_disabled':
        return '#f59e0b'; // amber
      default:
        return '#6b7280';
    }
  };

  return (
    <div className="control-plane">
      <div className="control-header">
        <h2>Control Plane</h2>
        <div className="status-indicator">
          <span
            className="status-dot"
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className="status-text">{connectionStatus}</span>
        </div>
      </div>

      <div className="control-section">
        <h3>Connection Status</h3>
        <div className="status-card">
          <div className="status-row">
            <span>WebSocket:</span>
            <span style={{ color: getStatusColor() }}>
              {connectionStatus.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      <div className="control-section">
        <h3>Pump Control</h3>
        <div className="status-card">
          <div className="status-row">
            <span>Current State:</span>
            <span style={{ color: getPumpStateColor() }}>
              {pumpState.toUpperCase()}
            </span>
          </div>
          <div className="status-row">
            <span>Running:</span>
            <span>{isRunning ? 'YES' : 'NO'}</span>
          </div>
        </div>

        <div className="button-group">
          <button
            onClick={startPump}
            disabled={connectionStatus !== 'connected' || pumpState === 'on'}
            className="btn btn-primary"
          >
            Start Pump
          </button>
          <button
            onClick={stopPump}
            disabled={connectionStatus !== 'connected' || pumpState === 'off'}
            className="btn btn-danger"
          >
            Stop Pump
          </button>
        </div>
      </div>

      <div className="control-section">
        <h3>Warning System</h3>
        <div className="button-group">
          <button
            onClick={setWarningDisabled}
            disabled={connectionStatus !== 'connected' || pumpState === 'warning_disabled'}
            className="btn btn-warning"
          >
            Disable Warning
          </button>
          <button
            onClick={setWarningEnabled}
            disabled={connectionStatus !== 'connected' || pumpState !== 'warning_disabled'}
            className="btn btn-secondary"
          >
            Enable Warning
          </button>
        </div>
      </div>

      <div className="control-section">
        <h3>Data Management</h3>
        <div className="button-group">
          <button
            onClick={clearData}
            className="btn btn-secondary"
          >
            Clear Data History
          </button>
        </div>
      </div>
    </div>
  );
}

