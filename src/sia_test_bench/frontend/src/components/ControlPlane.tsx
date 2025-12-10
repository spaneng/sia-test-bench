import { useEffect, useState, useRef } from 'react';
import { useTestBenchStore } from '../store/useTestBenchStore';
import { useWebSocket } from '../hooks/useWebSocket';
import './ControlPlane.css';

export function ControlPlane() {
  const {
    selectedPump,
    availablePumps,
    isLoadingPumps,
    pumpState,
    isRunning,
    connectionStatus,
    currentTestView,
    targetFlow,
    startPump,
    stopPump,
    setSelectedPump,
    setCurrentTestView,
    setTargetFlow,
    fetchAvailablePumps,
  } = useTestBenchStore();
  
  const { sendMessage } = useWebSocket();

  const [isExiting, setIsExiting] = useState(false);
  const [testViewExiting, setTestViewExiting] = useState(false);
  const [pumpSelectionExiting, setPumpSelectionExiting] = useState(false);
  const [testHeaderExiting, setTestHeaderExiting] = useState(false);
  const [maxPressureConfirmed, setMaxPressureConfirmed] = useState(false);
  const [maxFlowConfirmed, setMaxFlowConfirmed] = useState(false);
  const [maxPressureVerifying, setMaxPressureVerifying] = useState(false);
  const [maxFlowVerifying, setMaxFlowVerifying] = useState(false);
  const [maxPressureVerified, setMaxPressureVerified] = useState(false);
  const [maxFlowVerified, setMaxFlowVerified] = useState(false);
  const [showPumpInfoPopover, setShowPumpInfoPopover] = useState(false);
  const [popoverExiting, setPopoverExiting] = useState(false);
  const pumpInfoRef = useRef<HTMLDivElement>(null);
  const [manualControlExiting, setManualControlExiting] = useState(false);
  const [pressureTestProgress, setPressureTestProgress] = useState(0);
  const [flowTestProgress, setFlowTestProgress] = useState(0);
  const [isTestRunning, setIsTestRunning] = useState(false);

  useEffect(() => {
    fetchAvailablePumps();
  }, [fetchAvailablePumps]);

  // Handle closing popover with exit animation
  const handleClosePopover = () => {
    setPopoverExiting(true);
    setTimeout(() => {
      setShowPumpInfoPopover(false);
      setPopoverExiting(false);
    }, 200); // Match animation duration
  };

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Don't close if clicking on the popover itself or backdrop (they have their own handlers)
      if (target.closest('.pump-info-popover') || target.closest('.popover-backdrop')) {
        return;
      }
      if (pumpInfoRef.current && !pumpInfoRef.current.contains(target)) {
        handleClosePopover();
      }
    };

    if (showPumpInfoPopover && !popoverExiting) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPumpInfoPopover, popoverExiting]);

  // Listen for test progress updates from WebSocket
  useEffect(() => {
    const ws = new WebSocket(import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws');
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'test_progress') {
          if (data.test_type === 'pressure') {
            setPressureTestProgress(data.progress || 0);
            if (data.progress >= 100) {
              setIsTestRunning(false);
            }
          } else if (data.test_type === 'flow') {
            setFlowTestProgress(data.progress || 0);
            if (data.progress >= 100) {
              setIsTestRunning(false);
            }
          }
        }
      } catch (error) {
        // Ignore parsing errors
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Check if a test is in progress (after accept button is clicked)
  const isTestInProgress = (currentTestView === 'max_pressure' && maxPressureConfirmed) ||
                           (currentTestView === 'max_flow' && maxFlowConfirmed) ||
                           currentTestView === 'auto';

  // Handle exit transition when manual control gets disabled
  useEffect(() => {
    if (isTestInProgress) {
      // Test started - exit controls
      setManualControlExiting(true);
      setTimeout(() => {
        setManualControlExiting(false);
      }, 300);
    } else {
      // Test ended - reset exit state
      setManualControlExiting(false);
    }
  }, [isTestInProgress]);

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

  const handlePumpSelect = (pumpId: string) => {
    if (!pumpId) {
      setSelectedPump(null);
      return;
    }
    const pump = availablePumps.find((p) => p.id === pumpId);
    if (pump) {
      // Trigger exit animation before changing page
      setPumpSelectionExiting(true);
      setTimeout(() => {
        setSelectedPump(pump);
        setPumpSelectionExiting(false);
      }, 400); // Match exit animation duration
    }
  };

  const handleTestButtonClick = (testType: 'auto' | 'max_pressure' | 'max_flow') => {
    if (currentTestView === 'none') {
      // First time selecting a test - exit header and buttons
      setTestHeaderExiting(true);
      setTimeout(() => {
        setCurrentTestView(testType);
        setTestHeaderExiting(false);
      }, 300); // Match exit animation duration
    } else if (currentTestView !== testType) {
      // Switching between tests - exit current test view
      setTestViewExiting(true);
      setTimeout(() => {
        setCurrentTestView(testType);
        setTestViewExiting(false);
      }, 200); // Match exit animation duration
    }
    // Reset confirmations when switching tests
    setMaxPressureConfirmed(false);
    setMaxFlowConfirmed(false);
    setMaxPressureVerifying(false);
    setMaxFlowVerifying(false);
    setMaxPressureVerified(false);
    setMaxFlowVerified(false);
    // TODO: For auto test, implement sequential execution of max pressure and max flow tests
  };

  const handleCancelTest = () => {
    // Exit test view and return to test selection (no animation)
    setCurrentTestView('none');
    setTestViewExiting(false);
    // Reset confirmations when canceling
    setMaxPressureConfirmed(false);
    setMaxFlowConfirmed(false);
    setMaxPressureVerifying(false);
    setMaxFlowVerifying(false);
    setMaxPressureVerified(false);
    setMaxFlowVerified(false);
    setPressureTestProgress(0);
    setFlowTestProgress(0);
    setIsTestRunning(false);
    // Send message to cancel test
    sendMessage({ type: 'test', command: 'cancel_test' });
  };

  const handleConfirmValves = () => {
    if (currentTestView === 'max_pressure') {
      setMaxPressureConfirmed(true);
      setMaxPressureVerifying(true);
      setPressureTestProgress(0);
      setIsTestRunning(true);
      // Send message to start pressure test
      sendMessage({ type: 'test', command: 'start_pressure_test' });
      // Simulate verification after 4 seconds
      setTimeout(() => {
        setMaxPressureVerifying(false);
        setMaxPressureVerified(true);
        // After showing green tick for 2 seconds, proceed to test content
        setTimeout(() => {
          setMaxPressureVerified(false);
        }, 2000);
      }, 4000);
    } else if (currentTestView === 'max_flow') {
      setMaxFlowConfirmed(true);
      setMaxFlowVerifying(true);
      setFlowTestProgress(0);
      setIsTestRunning(true);
      // Send message to start flow test
      sendMessage({ type: 'test', command: 'start_flow_test' });
      // Simulate verification after 4 seconds
      setTimeout(() => {
        setMaxFlowVerifying(false);
        setMaxFlowVerified(true);
        // After showing green tick for 2 seconds, proceed to test content
        setTimeout(() => {
          setMaxFlowVerified(false);
        }, 2000);
      }, 4000);
    }
  };

  const handleChangePump = () => {
    setIsExiting(true);
    setTestViewExiting(true);
    setTestHeaderExiting(false);
    setTimeout(() => {
      setSelectedPump(null);
      setCurrentTestView('none');
      setIsExiting(false);
      setTestViewExiting(false);
      setTestHeaderExiting(false);
      setPumpSelectionExiting(false);
    }, 400); // Match exit animation duration
  };

  // Page 1: Pump Selection
  if (!selectedPump) {
    return (
      <div className={`control-plane pump-selection-page ${pumpSelectionExiting ? 'exiting' : ''}`}>
        <div className="control-header">
          <h2>Select Pump</h2>
        </div>

        <div className="pump-selection-form">
          <div className="form-group">
            <label htmlFor="pump-select">Pump Type</label>
            <select
              id="pump-select"
              className="pump-select"
              value=""
              onChange={(e) => handlePumpSelect(e.target.value)}
              disabled={isLoadingPumps}
            >
              <option value="">-- Select a pump --</option>
              {availablePumps.map((pump: { id: string; name: string }) => (
                <option key={pump.id} value={pump.id}>
                  {pump.name}
                </option>
              ))}
            </select>
            {isLoadingPumps && <p className="loading-text">Loading pumps...</p>}
          </div>

          <div className="pump-selection-divider-wrapper">
            <div className="pump-selection-divider"></div>
            <span className="divider-text">OR</span>
            <div className="pump-selection-divider"></div>
          </div>

          <div className="barcode-scan-section">
            <div className="barcode-icon">
              <svg width="48" height="32" viewBox="0 0 48 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="4" width="2" height="24" fill="#374151"/>
                <rect x="6" y="4" width="1" height="24" fill="#374151"/>
                <rect x="9" y="4" width="2" height="24" fill="#374151"/>
                <rect x="13" y="4" width="1" height="24" fill="#374151"/>
                <rect x="16" y="4" width="3" height="24" fill="#374151"/>
                <rect x="21" y="4" width="1" height="24" fill="#374151"/>
                <rect x="24" y="4" width="2" height="24" fill="#374151"/>
                <rect x="28" y="4" width="1" height="24" fill="#374151"/>
                <rect x="31" y="4" width="2" height="24" fill="#374151"/>
                <rect x="35" y="4" width="1" height="24" fill="#374151"/>
                <rect x="38" y="4" width="3" height="24" fill="#374151"/>
                <rect x="43" y="4" width="1" height="24" fill="#374151"/>
                <rect x="46" y="4" width="2" height="24" fill="#374151"/>
              </svg>
            </div>
            <p className="barcode-text">Scan the barcode on the pump to proceed</p>
          </div>
        </div>
      </div>
    );
  }

  // Page 2: Test and Control Interface
  return (
    <div className={`control-plane ${isExiting ? 'exiting' : ''}`}>
      <div className="control-header">
        <h2>Control Pump</h2>
        <button
          className="btn-change-pump"
          onClick={handleChangePump}
        >
          Change Pump
        </button>
      </div>

      <div className="pump-info" ref={pumpInfoRef}>
        <h3 className="selected-pump-name">{selectedPump.name}</h3>
        <button
          className="btn-info-icon"
          onClick={() => setShowPumpInfoPopover(!showPumpInfoPopover)}
          aria-label="Show pump information"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <path d="M10 7V10M10 13H10.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        {showPumpInfoPopover && selectedPump.maxRPM !== undefined && (
          <>
            <div className={`popover-backdrop ${popoverExiting ? 'exiting' : ''}`} onClick={handleClosePopover}></div>
            <div className={`pump-info-popover ${popoverExiting ? 'exiting' : ''}`}>
              <div className="pump-popover-header">
                <h2 className="pump-popover-title">{selectedPump.name}</h2>
                <button
                  className="btn-close-popover"
                  onClick={handleClosePopover}
                  aria-label="Close pump information"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <div className="pump-details">
            <div className="pump-detail-item">
              <span className="pump-detail-label">Max RPM:</span>
              <span className="pump-detail-value">{selectedPump.maxRPM.toLocaleString()} RPM</span>
            </div>
            {selectedPump.maxFlowRate !== undefined && (
              <div className="pump-detail-item">
                <span className="pump-detail-label">Max Flow Rate:</span>
                <span className="pump-detail-value">{selectedPump.maxFlowRate} GPM</span>
              </div>
            )}
            {selectedPump.maxPressure !== undefined && (
              <div className="pump-detail-item">
                <span className="pump-detail-label">Max Pressure:</span>
                <span className="pump-detail-value">{selectedPump.maxPressure} PSI</span>
              </div>
            )}
            {selectedPump.currentDraw !== undefined && (
              <div className="pump-detail-item">
                <span className="pump-detail-label">Current Draw:</span>
                <span className="pump-detail-value">{selectedPump.currentDraw} A</span>
              </div>
            )}
            {selectedPump.strokeLength !== undefined && (
              <div className="pump-detail-item">
                <span className="pump-detail-label">Stroke Length:</span>
                <span className="pump-detail-value">{selectedPump.strokeLength} in</span>
              </div>
            )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Top Section: Test Section */}
      <div className="test-section">
        {currentTestView === 'none' && (
          <>
            <h3 className={`test-section-heading ${testHeaderExiting ? 'exiting' : ''}`}>
              Select your Test
            </h3>
            <div className={`test-buttons ${testHeaderExiting ? 'exiting' : ''}`}>
              <button
                className="btn btn-test"
                onClick={() => handleTestButtonClick('auto')}
              >
                Auto
              </button>
              <button
                className="btn btn-test"
                onClick={() => handleTestButtonClick('max_pressure')}
              >
                Max Pressure
              </button>
              <button
                className="btn btn-test"
                onClick={() => handleTestButtonClick('max_flow')}
              >
                Max Flow
              </button>
            </div>
          </>
        )}

        {/* Test View Display */}
        {currentTestView !== 'none' && (
          <div 
            className={`test-view-container ${testViewExiting ? 'exiting' : ''}`}
            key={currentTestView}
          >
            <div className="test-view-header">
              <h4 className="test-view-title">
                {currentTestView === 'auto' && 'Auto Test'}
                {currentTestView === 'max_pressure' && 'Max Pressure Test'}
                {currentTestView === 'max_flow' && 'Max Flow Test'}
              </h4>
              <button
                className="btn btn-cancel-test"
                onClick={handleCancelTest}
              >
                Cancel Test
              </button>
            </div>
            {currentTestView === 'auto' && (
              <div className="test-view" key="auto-view">
                <p>Running Max Pressure Test and Max Flow Test sequentially...</p>
              </div>
            )}
            {currentTestView === 'max_pressure' && (
              <>
                <div className="test-view" key="max-pressure-view">
                  {!maxPressureConfirmed ? (
                    <div className="test-confirmation-section">
                      <p className="confirmation-message">
                        Please confirm the valves and relief have been set
                      </p>
                      <button
                        className="btn btn-primary btn-confirm"
                        onClick={handleConfirmValves}
                      >
                        Accept
                      </button>
                    </div>
                  ) : maxPressureVerifying ? (
                    <div className="test-verification-section">
                      <div className="loading-spinner"></div>
                      <p className="verification-message">Verifying pressure...</p>
                    </div>
                  ) : maxPressureVerified ? (
                    <div className="test-verification-section">
                      <div className="success-checkmark">✓</div>
                      <p className="verification-message">Verifying pressure...</p>
                    </div>
                  ) : (
                    <p>Max Pressure Test section content will go here.</p>
                  )}
                </div>
                {/* Progress bar at bottom of test section */}
                {isTestRunning && currentTestView === 'max_pressure' && maxPressureConfirmed && !maxPressureVerifying && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${pressureTestProgress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{pressureTestProgress.toFixed(1)}%</p>
                  </div>
                )}
              </>
            )}
            {currentTestView === 'max_flow' && (
              <>
                <div className="test-view" key="max-flow-view">
                  {!maxFlowConfirmed ? (
                    <div className="test-confirmation-section">
                      <p className="confirmation-message">
                        Please confirm the valves and relief have been set
                      </p>
                      <button
                        className="btn btn-primary btn-confirm"
                        onClick={handleConfirmValves}
                      >
                        Accept
                      </button>
                    </div>
                  ) : maxFlowVerifying ? (
                    <div className="test-verification-section">
                      <div className="loading-spinner"></div>
                      <p className="verification-message">Verifying flow...</p>
                    </div>
                  ) : maxFlowVerified ? (
                    <div className="test-verification-section">
                      <div className="success-checkmark">✓</div>
                      <p className="verification-message">Verifying flow...</p>
                    </div>
                  ) : (
                    <p>Max Flow Test section content will go here.</p>
                  )}
                </div>
                {/* Progress bar at bottom of test section */}
                {isTestRunning && currentTestView === 'max_flow' && maxFlowConfirmed && !maxFlowVerifying && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${flowTestProgress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{flowTestProgress.toFixed(1)}%</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom Section: Manual Control */}
      <div className={`manual-control-section ${isExiting ? 'exiting' : ''}`}>
        <h3>Manual Control</h3>
        {isTestInProgress ? (
          <div className="manual-control-disabled">
            <p className="disabled-message">
              Manual controls are disabled when a test is in progress.
            </p>
          </div>
        ) : (
          <div className={`manual-control-content ${manualControlExiting ? 'exiting' : ''}`}>
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

        <div className="control-row">
          <div className="button-group button-group-left">
            <button
              onClick={startPump}
              disabled={connectionStatus !== 'connected' || pumpState === 'on'}
              className="btn btn-primary btn-narrow"
            >
              Start
            </button>
            <button
              onClick={stopPump}
              disabled={connectionStatus !== 'connected' || pumpState === 'off'}
              className="btn btn-danger btn-narrow"
            >
              Stop
            </button>
          </div>

          <div className="target-flow-control">
            <label htmlFor="target-flow-input">Target Flow (GPM)</label>
            <div className="target-flow-input-group">
              <input
                type="range"
                id="target-flow-slider"
                min="0"
                max="100"
                step="0.1"
                value={targetFlow}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  setTargetFlow(value);
                  sendMessage({ type: 'control', command: 'set_target_flow', value });
                }}
                className="target-flow-slider"
              />
              <input
                type="number"
                id="target-flow-input"
                min="0"
                max="100"
                step="0.1"
                value={targetFlow}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || 0;
                  const clampedValue = Math.max(0, Math.min(100, value));
                  setTargetFlow(clampedValue);
                  sendMessage({ type: 'control', command: 'set_target_flow', value: clampedValue });
                }}
                className="target-flow-input"
              />
            </div>
          </div>
        </div>
          </div>
        )}
      </div>
    </div>
  );
}
