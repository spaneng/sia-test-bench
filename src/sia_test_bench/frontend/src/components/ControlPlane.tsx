import { useEffect, useState, useRef } from 'react';
import { useTestBenchStore } from '../store/useTestBenchStore';
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
    stateMachineState,
    targetFlow,
    maxPressureProgress,
    maxFlowProgress,
    flowAccuracyProgress,
    maxPressureComplete,
    maxFlowComplete,
    flowAccuracyComplete,
    startPump,
    stopPump,
    setSelectedPump,
    setCurrentTestView,
    setTargetFlow,
    resetTestProgress,
    fetchAvailablePumps,
    sendMessage,
  } = useTestBenchStore();

  const [isExiting, setIsExiting] = useState(false);
  const [testViewExiting, setTestViewExiting] = useState(false);
  const [pumpSelectionExiting, setPumpSelectionExiting] = useState(false);
  const [testHeaderExiting, setTestHeaderExiting] = useState(false);
  const [maxPressureConfirmed, setMaxPressureConfirmed] = useState(false);
  const [maxFlowConfirmed, setMaxFlowConfirmed] = useState(false);
  const [flowAccuracyConfirmed, setFlowAccuracyConfirmed] = useState(false);
  const [maxPressureVerifying, setMaxPressureVerifying] = useState(false);
  const [maxFlowVerifying, setMaxFlowVerifying] = useState(false);
  const [flowAccuracyVerifying, setFlowAccuracyVerifying] = useState(false);
  const [maxPressureVerified, setMaxPressureVerified] = useState(false);
  const [maxFlowVerified, setMaxFlowVerified] = useState(false);
  const [flowAccuracyVerified, setFlowAccuracyVerified] = useState(false);
  const [showPumpInfoPopover, setShowPumpInfoPopover] = useState(false);
  const [popoverExiting, setPopoverExiting] = useState(false);
  const pumpInfoRef = useRef<HTMLDivElement>(null);
  const [manualControlExiting, setManualControlExiting] = useState(false);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [showPumpInfoView, setShowPumpInfoView] = useState(false);
  const [editablePumpData, setEditablePumpData] = useState<{
    name: string;
    model?: string;
    maxRPM?: number;
    maxFlowRate?: number;
    maxPressure?: number;
    currentDraw?: number;
    strokeLength?: number;
  } | null>(null);
  const hasInitializedPumpInfo = useRef<string | null>(null);

  useEffect(() => {
    fetchAvailablePumps();
  }, [fetchAvailablePumps]);

  // Handle test completion - auto-return to test selection after 3 seconds (only in standalone mode)
  useEffect(() => {
    if (maxPressureComplete) {
      const timer = setTimeout(() => {
        // Notify backend that frontend has finished showing completion message
        sendMessage({ type: 'test', command: 'acknowledge_pressure_complete' });
        
        // Only reset to 'none' if not in auto mode
        if (currentTestView === 'max_pressure') {
          setCurrentTestView('none');
          resetTestProgress();
          setIsTestRunning(false);
        }
        
        // Reset test-specific flags
        setMaxPressureConfirmed(false);
        setMaxPressureVerifying(false);
        setMaxPressureVerified(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [maxPressureComplete, currentTestView, setCurrentTestView, resetTestProgress, sendMessage]);

  useEffect(() => {
    if (maxFlowComplete) {
      const timer = setTimeout(() => {
        // Notify backend that frontend has finished showing completion message
        sendMessage({ type: 'test', command: 'acknowledge_flow_complete' });
        
        // Only reset to 'none' if not in auto mode
        if (currentTestView === 'max_flow') {
          setCurrentTestView('none');
          resetTestProgress();
          setIsTestRunning(false);
        }
        
        // Reset test-specific flags
        setMaxFlowConfirmed(false);
        setMaxFlowVerifying(false);
        setMaxFlowVerified(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [maxFlowComplete, currentTestView, setCurrentTestView, resetTestProgress, sendMessage]);

  useEffect(() => {
    if (flowAccuracyComplete) {
      const timer = setTimeout(() => {
        // Notify backend that frontend has finished showing completion message
        sendMessage({ type: 'test', command: 'acknowledge_flow_accuracy_complete' });
        
        // Only reset to 'none' if not in auto mode
        if (currentTestView === 'flow_accuracy') {
          setCurrentTestView('none');
          resetTestProgress();
          setIsTestRunning(false);
        } else if (currentTestView === 'auto') {
          // In auto mode, after flow accuracy completes, return to test selection
          setCurrentTestView('none');
          resetTestProgress();
          setIsTestRunning(false);
        }
        
        // Reset test-specific flags
        setFlowAccuracyConfirmed(false);
        setFlowAccuracyVerifying(false);
        setFlowAccuracyVerified(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [flowAccuracyComplete, currentTestView, setCurrentTestView, resetTestProgress, sendMessage]);

  // Show pump info view when a pump is first selected
  useEffect(() => {
    if (selectedPump) {
      // Only initialize if this is a new pump (different ID) or if we haven't initialized yet
      if (hasInitializedPumpInfo.current !== selectedPump.id) {
        hasInitializedPumpInfo.current = selectedPump.id;
        setShowPumpInfoView(true);
        setEditablePumpData({
          name: selectedPump.name || '',
          model: selectedPump.model,
          maxRPM: selectedPump.maxRPM,
          maxFlowRate: selectedPump.maxFlowRate,
          maxPressure: selectedPump.maxPressure,
          currentDraw: selectedPump.currentDraw,
          strokeLength: selectedPump.strokeLength,
        });
      }
    } else {
      setShowPumpInfoView(false);
      setEditablePumpData(null);
      hasInitializedPumpInfo.current = null;
    }
  }, [selectedPump]);

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


  // Check if a test is in progress (after accept button is clicked)
  const isTestInProgress = (currentTestView === 'max_pressure' && maxPressureConfirmed) ||
                           (currentTestView === 'max_flow' && maxFlowConfirmed) ||
                           (currentTestView === 'flow_accuracy' && flowAccuracyConfirmed) ||
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
      setShowPumpInfoView(false);
      return;
    }
    const pump = availablePumps.find((p) => p.id === pumpId);
    if (pump) {
      // Trigger exit animation before changing page
      setPumpSelectionExiting(true);
      setTimeout(() => {
        setSelectedPump(pump);
        setShowPumpInfoView(true);
        setPumpSelectionExiting(false);
      }, 400); // Match exit animation duration
    }
  };

  const handleTestButtonClick = (testType: 'auto' | 'max_pressure' | 'max_flow' | 'flow_accuracy') => {
    // Send test mode to backend
    sendMessage({ type: 'test', command: 'set_test_mode', mode: testType });
    
    // Reset progress when starting a new test
    resetTestProgress();
    
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
    setFlowAccuracyConfirmed(false);
    setMaxPressureVerifying(false);
    setMaxFlowVerifying(false);
    setFlowAccuracyVerifying(false);
    setMaxPressureVerified(false);
    setMaxFlowVerified(false);
    setFlowAccuracyVerified(false);
    // TODO: For auto test, implement sequential execution of max pressure and max flow tests
  };

  const handleCancelTest = () => {
    // Send message to cancel test
    sendMessage({ type: 'test', command: 'cancel_test' });
    
    // Exit test view and return to test selection (no animation)
    setCurrentTestView('none');
    setTestViewExiting(false);
    // Reset confirmations when canceling
    setMaxPressureConfirmed(false);
    setMaxFlowConfirmed(false);
    setFlowAccuracyConfirmed(false);
    setMaxPressureVerifying(false);
    setMaxFlowVerifying(false);
    setFlowAccuracyVerifying(false);
    setMaxPressureVerified(false);
    setMaxFlowVerified(false);
    setFlowAccuracyVerified(false);
    setIsTestRunning(false);
    // Reset progress bars
    resetTestProgress();
  };

  const handleConfirmValves = () => {
    // Determine which test to confirm based on currentTestView or stateMachineState (for auto mode)
    const testToConfirm = currentTestView === 'auto' 
      ? (stateMachineState.includes('max_pressure') ? 'max_pressure' 
         : stateMachineState.includes('max_flow') && !stateMachineState.includes('flow_accuracy') ? 'max_flow'
         : stateMachineState.includes('flow_accuracy') ? 'flow_accuracy'
         : null)
      : currentTestView;
    
    if (testToConfirm === 'max_pressure') {
      setMaxPressureConfirmed(true);
      setMaxPressureVerifying(true);
      setIsTestRunning(true);
      // Send confirmation to backend
      sendMessage({ type: 'test', command: 'confirm_pressure_test' });
      // Simulate verification after 4 seconds
      setTimeout(() => {
        setMaxPressureVerifying(false);
        setMaxPressureVerified(true);
        // After showing green tick for 2 seconds, proceed to test content
        setTimeout(() => {
          setMaxPressureVerified(false);
        }, 2000);
      }, 4000);
    } else if (testToConfirm === 'max_flow') {
      setMaxFlowConfirmed(true);
      setMaxFlowVerifying(true);
      setIsTestRunning(true);
      // Send confirmation to backend
      sendMessage({ type: 'test', command: 'confirm_flow_test' });
      // Simulate verification after 4 seconds
      setTimeout(() => {
        setMaxFlowVerifying(false);
        setMaxFlowVerified(true);
        // After showing green tick for 2 seconds, proceed to test content
        setTimeout(() => {
          setMaxFlowVerified(false);
        }, 2000);
      }, 4000);
    } else if (testToConfirm === 'flow_accuracy') {
      setFlowAccuracyConfirmed(true);
      setFlowAccuracyVerifying(true);
      setIsTestRunning(true);
      // Send confirmation to backend
      sendMessage({ type: 'test', command: 'confirm_flow_accuracy_test' });
      // Simulate verification after 4 seconds
      setTimeout(() => {
        setFlowAccuracyVerifying(false);
        setFlowAccuracyVerified(true);
        // After showing green tick for 2 seconds, proceed to test content
        setTimeout(() => {
          setFlowAccuracyVerified(false);
        }, 2000);
      }, 4000);
    }
  };

  const handleChangePump = () => {
    // Reset test mode when changing pumps
    sendMessage({ type: 'test', command: 'set_test_mode', mode: 'off' });
    
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
      setShowPumpInfoView(false);
    }, 400); // Match exit animation duration
  };

  const handleContinueFromPumpInfo = () => {
    // Update the selected pump with edited values before continuing
    if (selectedPump && editablePumpData) {
      const updatedPump = {
        ...selectedPump,
        ...editablePumpData,
      };
      setSelectedPump(updatedPump);
    }
    // Set showPumpInfoView to false - the ref will prevent useEffect from resetting it
    setShowPumpInfoView(false);
  };

  const handlePumpDataChange = (field: string, value: string | number) => {
    if (!editablePumpData) return;
    
    setEditablePumpData({
      ...editablePumpData,
      [field]: value === '' ? undefined : (typeof value === 'string' && field !== 'name' && field !== 'model' ? parseFloat(value) || undefined : value),
    });
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

  // Page 2a: Pump Info View
  if (selectedPump && showPumpInfoView && editablePumpData) {
    return (
      <div className={`control-plane pump-info-view ${isExiting ? 'exiting' : ''}`}>
        <div className="control-header">
          <h2>Pump Information</h2>
          <button
            className="btn-change-pump"
            onClick={handleChangePump}
          >
            Change Pump
          </button>
        </div>

        <div className="pump-info-display">
          <div className="pump-info-form-group">
            <label htmlFor="pump-name" className="pump-info-form-label">Pump Name:</label>
            <input
              id="pump-name"
              type="text"
              className="pump-info-form-input"
              value={editablePumpData.name}
              onChange={(e) => handlePumpDataChange('name', e.target.value)}
              placeholder="Enter pump name"
            />
          </div>
          
          <div className="pump-info-form-group">
            <label htmlFor="pump-model" className="pump-info-form-label">Model:</label>
            <input
              id="pump-model"
              type="text"
              className="pump-info-form-input"
              value={editablePumpData.model || ''}
              onChange={(e) => handlePumpDataChange('model', e.target.value)}
              placeholder="Enter model"
            />
          </div>
          
          <div className="pump-info-details">
            <div className="pump-info-detail-item">
              <label htmlFor="pump-max-rpm" className="pump-info-detail-label">Max RPM:</label>
              <div className="pump-info-input-wrapper">
                <input
                  id="pump-max-rpm"
                  type="number"
                  className="pump-info-detail-input"
                  value={editablePumpData.maxRPM || ''}
                  onChange={(e) => handlePumpDataChange('maxRPM', e.target.value)}
                  placeholder="Enter max RPM"
                />
                <span className="pump-info-unit">RPM</span>
              </div>
            </div>
            
            <div className="pump-info-detail-item">
              <label htmlFor="pump-max-flow" className="pump-info-detail-label">Max Flow Rate:</label>
              <div className="pump-info-input-wrapper">
                <input
                  id="pump-max-flow"
                  type="number"
                  step="0.1"
                  className="pump-info-detail-input"
                  value={editablePumpData.maxFlowRate || ''}
                  onChange={(e) => handlePumpDataChange('maxFlowRate', e.target.value)}
                  placeholder="Enter max flow rate"
                />
                <span className="pump-info-unit">GPM</span>
              </div>
            </div>
            
            <div className="pump-info-detail-item">
              <label htmlFor="pump-max-pressure" className="pump-info-detail-label">Max Pressure:</label>
              <div className="pump-info-input-wrapper">
                <input
                  id="pump-max-pressure"
                  type="number"
                  step="0.1"
                  className="pump-info-detail-input"
                  value={editablePumpData.maxPressure || ''}
                  onChange={(e) => handlePumpDataChange('maxPressure', e.target.value)}
                  placeholder="Enter max pressure"
                />
                <span className="pump-info-unit">PSI</span>
              </div>
            </div>
            
            <div className="pump-info-detail-item">
              <label htmlFor="pump-current-draw" className="pump-info-detail-label">Current Draw:</label>
              <div className="pump-info-input-wrapper">
                <input
                  id="pump-current-draw"
                  type="number"
                  step="0.1"
                  className="pump-info-detail-input"
                  value={editablePumpData.currentDraw || ''}
                  onChange={(e) => handlePumpDataChange('currentDraw', e.target.value)}
                  placeholder="Enter current draw"
                />
                <span className="pump-info-unit">A</span>
              </div>
            </div>
            
            <div className="pump-info-detail-item">
              <label htmlFor="pump-stroke-length" className="pump-info-detail-label">Stroke Length:</label>
              <div className="pump-info-input-wrapper">
                <input
                  id="pump-stroke-length"
                  type="number"
                  step="0.1"
                  className="pump-info-detail-input"
                  value={editablePumpData.strokeLength || ''}
                  onChange={(e) => handlePumpDataChange('strokeLength', e.target.value)}
                  placeholder="Enter stroke length"
                />
                <span className="pump-info-unit">in</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pump-info-actions">
          <button
            className="btn btn-primary btn-continue"
            onClick={handleContinueFromPumpInfo}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // Page 2b: Test and Control Interface
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
              <button
                className="btn btn-test"
                onClick={() => handleTestButtonClick('flow_accuracy')}
              >
                Flow Accuracy
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
                {currentTestView === 'flow_accuracy' && 'Flow Accuracy Test'}
              </h4>
              <button
                className="btn btn-cancel-test"
                onClick={handleCancelTest}
              >
                Cancel Test
              </button>
            </div>
            {currentTestView === 'auto' && (
              <>
                {/* Show Max Pressure Test UI when in max_pressure states */}
                {(stateMachineState === 'max_pressure_start' || stateMachineState === 'max_pressure_run' || stateMachineState === 'max_pressure_end') && (
                  <>
                    <div className="test-view" key="auto-max-pressure-view">
                      {maxPressureComplete ? (
                        <div className="test-completion-section">
                          <div className="success-checkmark">✓</div>
                          <p className="completion-message">Max Pressure Test Complete</p>
                        </div>
                      ) : !maxPressureConfirmed ? (
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
                    {isTestRunning && maxPressureConfirmed && !maxPressureVerifying && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${maxPressureProgress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{maxPressureProgress.toFixed(1)}%</p>
                      </div>
                    )}
                  </>
                )}
                
                {/* Show Max Flow Test UI when in max_flow states */}
                {(stateMachineState === 'max_flow_start' || stateMachineState === 'max_flow_run' || stateMachineState === 'max_flow_end') && (
                  <>
                    <div className="test-view" key="auto-max-flow-view">
                      {maxFlowComplete ? (
                        <div className="test-completion-section">
                          <div className="success-checkmark">✓</div>
                          <p className="completion-message">Max Flow Test Complete</p>
                        </div>
                      ) : !maxFlowConfirmed ? (
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
                    {isTestRunning && maxFlowConfirmed && !maxFlowVerifying && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${maxFlowProgress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{maxFlowProgress.toFixed(1)}%</p>
                      </div>
                    )}
                  </>
                )}
                
                {/* Show Flow Accuracy Test UI when in flow_accuracy states */}
                {(stateMachineState === 'flow_accuracy_start' || stateMachineState === 'flow_accuracy_run' || stateMachineState === 'flow_accuracy_end') && (
                  <>
                    <div className="test-view" key="auto-flow-accuracy-view">
                      {flowAccuracyComplete ? (
                        <div className="test-completion-section">
                          <div className="success-checkmark">✓</div>
                          <p className="completion-message">Flow Accuracy Test Complete</p>
                        </div>
                      ) : !flowAccuracyConfirmed ? (
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
                      ) : flowAccuracyVerifying ? (
                        <div className="test-verification-section">
                          <div className="loading-spinner"></div>
                          <p className="verification-message">Verifying flow...</p>
                        </div>
                      ) : flowAccuracyVerified ? (
                        <div className="test-verification-section">
                          <div className="success-checkmark">✓</div>
                          <p className="verification-message">Verifying flow...</p>
                        </div>
                      ) : (
                        <p>Flow Accuracy Test section content will go here.</p>
                      )}
                    </div>
                    {isTestRunning && flowAccuracyConfirmed && !flowAccuracyVerifying && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${flowAccuracyProgress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{flowAccuracyProgress.toFixed(1)}%</p>
                      </div>
                    )}
                  </>
                )}
                
                {/* Show initial state when auto test hasn't started yet */}
                {stateMachineState === 'auto_start' && (
                  <div className="test-view" key="auto-starting-view">
                    <p>Initializing auto test sequence...</p>
                  </div>
                )}
              </>
            )}
            {currentTestView === 'max_pressure' && (
              <>
                <div className="test-view" key="max-pressure-view">
                  {maxPressureComplete ? (
                    <div className="test-completion-section">
                      <div className="success-checkmark">✓</div>
                      <p className="completion-message">Max Pressure Test Complete</p>
                    </div>
                  ) : !maxPressureConfirmed ? (
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
                        style={{ width: `${maxPressureProgress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{maxPressureProgress.toFixed(1)}%</p>
                  </div>
                )}
              </>
            )}
            {currentTestView === 'max_flow' && (
              <>
                <div className="test-view" key="max-flow-view">
                  {maxFlowComplete ? (
                    <div className="test-completion-section">
                      <div className="success-checkmark">✓</div>
                      <p className="completion-message">Max Flow Test Complete</p>
                    </div>
                  ) : !maxFlowConfirmed ? (
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
                        style={{ width: `${maxFlowProgress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{maxFlowProgress.toFixed(1)}%</p>
                  </div>
                )}
              </>
            )}
            
            {currentTestView === 'flow_accuracy' && (
              <>
                <div className="test-view" key="flow-accuracy-view">
                  {flowAccuracyComplete ? (
                    <div className="test-completion-section">
                      <div className="success-checkmark">✓</div>
                      <p className="completion-message">Flow Accuracy Test Complete</p>
                    </div>
                  ) : !flowAccuracyConfirmed ? (
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
                  ) : flowAccuracyVerifying ? (
                    <div className="test-verification-section">
                      <div className="loading-spinner"></div>
                      <p className="verification-message">Verifying flow...</p>
                    </div>
                  ) : flowAccuracyVerified ? (
                    <div className="test-verification-section">
                      <div className="success-checkmark">✓</div>
                      <p className="verification-message">Verifying flow...</p>
                    </div>
                  ) : (
                    <p>Flow Accuracy Test section content will go here.</p>
                  )}
                </div>
                {/* Progress bar at bottom of test section */}
                {isTestRunning && currentTestView === 'flow_accuracy' && flowAccuracyConfirmed && !flowAccuracyVerifying && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${flowAccuracyProgress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{flowAccuracyProgress.toFixed(1)}%</p>
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
