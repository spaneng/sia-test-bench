import { useEffect, useState, useRef } from 'react';
import { useTestBenchStore } from '../store/useTestBenchStore';
import './ControlPlane.css';

export function ControlPlane() {
  const {
    selectedPump,
    availablePumps,
    isLoadingPumps,
    pumpState,
    connectionStatus,
    currentTestView,
    stateMachineState,
    targetFlow,
    maxPressureVerifyStatus,
    maxPressureStabiliseProgress,
    maxPressureProgress,
    maxFlowStabiliseProgress,
    maxFlowProgress,
    flowAccuracyStabiliseProgress,
    flowAccuracyPhase1Progress,
    flowAccuracyPhase2Progress,
    flowAccuracyPhase3Progress,
    maxPressureComplete,
    maxFlowComplete,
    flowAccuracyComplete,
    isLoadingReport,
    reportError,
    reportUrl,
    startPump,
    stopPump,
    setSelectedPump,
    setCurrentTestView,
    setTargetFlow,
    resetTestProgress,
    fetchAvailablePumps,
    sendMessage,
    finalizeTestAndGenerateReport,
    clearReportState,
    setTestStartTimestamp,
    setTestEndTimestamp,
    testStartTimestamp,
    dataHistory,
    inputFlash,
    latestData,
  } = useTestBenchStore();

  const [isExiting, setIsExiting] = useState(false);
  const [testViewExiting, setTestViewExiting] = useState(false);
  const [pumpSelectionExiting, setPumpSelectionExiting] = useState(false);
  const [testHeaderExiting, setTestHeaderExiting] = useState(false);
  const [maxPressureConfirmed, setMaxPressureConfirmed] = useState(false);
  const [maxFlowConfirmed, setMaxFlowConfirmed] = useState(false);
  const [flowAccuracyConfirmed, setFlowAccuracyConfirmed] = useState(false);
  const [pressureStabilising, setPressureStabilising] = useState(false);
  const [pressureFailed, setPressureFailed] = useState(false);
  const [flowStabilising, setFlowStabilising] = useState(false);
  const [flowFailed, setFlowFailed] = useState(false);
  const [flowAccuracyStabilising, setFlowAccuracyStabilising] = useState(false);
  const [flowAccuracyFailed, setFlowAccuracyFailed] = useState(false);
  const [maxPressureVerifying, setMaxPressureVerifying] = useState(false);
  const [maxFlowVerifying, setMaxFlowVerifying] = useState(false);
  const [flowAccuracyVerifying, setFlowAccuracyVerifying] = useState(false);
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
    serialNumber?: string;
    maxRPM?: number;
    maxFlowRate?: number;
    maxPressure?: number;
    currentDraw?: number;
    strokeLength?: number;
    supplyVoltage?: string;
  } | null>(null);
  const hasInitializedPumpInfo = useRef<string | null>(null);
  const downloadedReportUrl = useRef<string | null>(null);
  const hasAppliedSnapshot = useRef(false);
  // Flow pending / confirmation state
  const [localSliderValue, setLocalSliderValue] = useState(targetFlow);
  const [isFlowPending, setIsFlowPending] = useState(false);
  const [isFlowShaking, setIsFlowShaking] = useState(false);
  const previousFlow = useRef<number>(targetFlow);
  const expectedDutyCycle = useRef<number | null>(null);
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedSlider = useRef(false);

  // Seed slider from current target duty cycle on first render with data
  useEffect(() => {
    if (hasInitializedSlider.current) return;
    const dutyCycle = latestData?.targetPumpDutyCycle;
    if (dutyCycle == null || dutyCycle === undefined) return;
    const maxFlow = selectedPump?.maxFlowRate ?? 100;
    const flowFromDuty = (dutyCycle / 100) * maxFlow;
    setLocalSliderValue(parseFloat(flowFromDuty.toFixed(2)));
    setTargetFlow(parseFloat(flowFromDuty.toFixed(2)));
    hasInitializedSlider.current = true;
  }, [latestData, selectedPump]);

  // Sync localSliderValue from external targetFlow changes when not pending
  useEffect(() => {
    if (!isFlowPending) {
      setLocalSliderValue(targetFlow);
    }
  }, [targetFlow, isFlowPending]);

  // Watch pumpDutyCycle for confirmation
  useEffect(() => {
    if (!isFlowPending || expectedDutyCycle.current === null || !latestData) return;
    const currentDutyCycle = latestData.pumpDutyCycle;
    if (currentDutyCycle === undefined) return;
    if (Math.abs(currentDutyCycle - expectedDutyCycle.current) <= 1) {
      // Confirmed — re-enable slider
      if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
      confirmTimeout.current = null;
      expectedDutyCycle.current = null;
      setIsFlowPending(false);
    }
  }, [latestData, isFlowPending]);

  const commitFlowRate = (value: number) => {
    const maxFlow = selectedPump?.maxFlowRate ?? 100;
    const clamped = Math.max(0, Math.min(maxFlow, value));

    setTargetFlow(clamped);
    setLocalSliderValue(clamped);
    sendMessage({ type: 'control', command: 'set_target_flow', value: clamped });
    sendMessage({ type: 'input_activity', elementId: 'set_target_flow' });

    // Only engage pending/confirmation when pumpDutyCycle is available in the data stream
    const hasDutyCycleFeedback = latestData?.pumpDutyCycle !== undefined && latestData?.pumpDutyCycle !== null;
    if (!hasDutyCycleFeedback) return;

    previousFlow.current = targetFlow;
    const dutyCyclePct = maxFlow > 0 ? (clamped / maxFlow) * 100 : 0;
    expectedDutyCycle.current = dutyCyclePct;
    setIsFlowPending(true);

    // Start timeout
    if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    confirmTimeout.current = setTimeout(() => {
      // Revert and shake
      setTargetFlow(previousFlow.current);
      setLocalSliderValue(previousFlow.current);
      sendMessage({ type: 'control', command: 'set_target_flow', value: previousFlow.current });
      expectedDutyCycle.current = null;
      setIsFlowPending(false);
      setIsFlowShaking(true);
      setTimeout(() => setIsFlowShaking(false), 500);
    }, 2000);
  };

  // Derive local UI flags from session snapshot state on initial load
  useEffect(() => {
    if (hasAppliedSnapshot.current) return;

    // If a pump is already selected (from snapshot), skip the pump info form
    if (selectedPump && showPumpInfoView) {
      setShowPumpInfoView(false);
    }

    if (stateMachineState === 'off') return;

    hasAppliedSnapshot.current = true;

    // Determine which test family is active
    const isMaxPressure = stateMachineState.startsWith('max_pressure_');
    const isMaxFlow = stateMachineState.startsWith('max_flow_');
    const isFlowAccuracy = stateMachineState.startsWith('flow_accuracy_');

    // Any active test state means test is running
    if (isMaxPressure || isMaxFlow || isFlowAccuracy) {
      setIsTestRunning(true);
    }

    // Past the _start state means the user has already confirmed
    const pastStart = (prefix: string) => {
      const suffix = stateMachineState.replace(prefix + '_', '');
      return ['verify', 'stabilise', 'run', 'end', 'phase1', 'phase2', 'phase3'].includes(suffix);
    };

    if (isMaxPressure && pastStart('max_pressure')) {
      setMaxPressureConfirmed(true);
    }
    if (isMaxFlow && pastStart('max_flow')) {
      setMaxFlowConfirmed(true);
    }
    if (isFlowAccuracy && pastStart('flow_accuracy')) {
      setFlowAccuracyConfirmed(true);
    }

    // Verifying states
    if (stateMachineState === 'max_pressure_verify') {
      setMaxPressureVerifying(true);
    }
    if (stateMachineState === 'max_flow_verify') {
      setMaxFlowVerifying(true);
    }
    if (stateMachineState === 'flow_accuracy_verify') {
      setFlowAccuracyVerifying(true);
    }
  }, [stateMachineState, selectedPump, showPumpInfoView]);

  useEffect(() => {
    fetchAvailablePumps();
  }, [fetchAvailablePumps]);

  // Apply remote input flash — find element by data-element-id, add .remote-flash class
  useEffect(() => {
    if (!inputFlash) return;
    const el = document.querySelector(`[data-element-id="${inputFlash}"]`);
    if (!el) return;
    el.classList.remove('remote-flash');
    // Force reflow to restart animation
    void (el as HTMLElement).offsetWidth;
    el.classList.add('remote-flash');
    const timer = setTimeout(() => {
      el.classList.remove('remote-flash');
    }, 500);
    return () => clearTimeout(timer);
  }, [inputFlash]);

  // Auto-download only in auto-test chaining (where there's no Back button).
  // In standalone test views the user clicks the Download button explicitly.
  useEffect(() => {
    if (!reportUrl) {
      downloadedReportUrl.current = null;
      return;
    }

    if (currentTestView !== 'auto') {
      return;
    }

    if (reportUrl !== downloadedReportUrl.current) {
      downloadedReportUrl.current = reportUrl;

      const link = document.createElement('a');
      link.href = reportUrl;
      link.download = '';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [reportUrl, currentTestView]);

  // Track test start/end timestamps based on state machine state
  useEffect(() => {
    // Max-pressure capture begins at completion of Stage 1/3 of verify
    // (pressure has crossed the 10% build threshold → stageNumber ≥ 2).
    // Guarded by testStartTimestamp === null so it only fires once per cycle.
    const isMaxPressureStage1Complete =
      stateMachineState === 'max_pressure_verify' &&
      maxPressureVerifyStatus.stageNumber >= 2 &&
      testStartTimestamp === null;

    // Flow tests don't have a 3-stage verify — start at stabilise entry as before.
    const isFlowStabiliseState = stateMachineState === 'max_flow_stabilise' ||
                                 stateMachineState === 'flow_accuracy_stabilise';

    // Fallback for max pressure: if we somehow missed the stage-1 trigger,
    // still start capture on stabilise entry rather than losing the window.
    const isMaxPressureStabiliseFallback =
      stateMachineState === 'max_pressure_stabilise' && testStartTimestamp === null;

    if (isMaxPressureStage1Complete || isFlowStabiliseState || isMaxPressureStabiliseFallback) {
      if (dataHistory.length > 0 && dataHistory[dataHistory.length - 1]?.timestamp) {
        const latestTimestamp = dataHistory[dataHistory.length - 1].timestamp;
        setTestStartTimestamp(latestTimestamp);
      } else {
        setTestStartTimestamp(Date.now());
      }
    }

    // Test end states
    const isEndState = stateMachineState === 'max_pressure_end' ||
                       stateMachineState === 'max_flow_end' ||
                       stateMachineState === 'flow_accuracy_end';

    if (isEndState && dataHistory.length > 0 && dataHistory[dataHistory.length - 1]?.timestamp) {
      const lastTimestamp = dataHistory[dataHistory.length - 1].timestamp;
      setTestEndTimestamp(lastTimestamp);
    }

    // Reset timestamps when leaving test states or starting a new test
    if (stateMachineState === 'off' ||
        stateMachineState === 'auto_start' ||
        stateMachineState === 'auto_stop' ||
        stateMachineState === 'max_pressure_start' ||
        stateMachineState === 'max_flow_start' ||
        stateMachineState === 'flow_accuracy_start') {
      setTestStartTimestamp(null);
      setTestEndTimestamp(null);
    }
  }, [stateMachineState, maxPressureVerifyStatus.stageNumber, testStartTimestamp, dataHistory, setTestStartTimestamp, setTestEndTimestamp]);

  // Watch state machine for max pressure verification/stabilization outcomes
  useEffect(() => {
    // Track when we're in the verify state
    if (stateMachineState === 'max_pressure_verify') {
      setPressureStabilising(true);
    }
    
    // On entry to max_pressure_stabilise, we've passed verify — go straight
    // into Stage 3/3 messaging. No "Pressure verified" green tick.
    if (stateMachineState === 'max_pressure_stabilise' && maxPressureVerifying && pressureStabilising) {
      setMaxPressureVerifying(false);
      setPressureStabilising(false);
    }
    
    // Check if we went back to max_pressure_start from max_pressure_verify (timeout/failed verification)
    if (stateMachineState === 'max_pressure_start' && pressureStabilising) {
      // Show failure message
      setMaxPressureVerifying(false);
      setPressureFailed(true);
      setPressureStabilising(false);
      setIsTestRunning(false);
      // After showing red X for 2 seconds, reset to Accept button
      setTimeout(() => {
        setPressureFailed(false);
        setMaxPressureConfirmed(false);
      }, 2000);
    }
  }, [stateMachineState, maxPressureVerifying, pressureStabilising]);

  // Watch state machine for max flow verification/stabilization outcomes
  useEffect(() => {
    // Track when we're in the verify state
    if (stateMachineState === 'max_flow_verify') {
      setFlowStabilising(true);
    }
    
    // Check if we just entered max_flow_stabilise from max_flow_verify (successful verification)
    if (stateMachineState === 'max_flow_stabilise' && maxFlowVerifying && flowStabilising) {
      setMaxFlowVerifying(false);
      setMaxFlowVerified(true);
      setFlowStabilising(false);
      // After showing green tick for 2 seconds, clear it
      setTimeout(() => {
        setMaxFlowVerified(false);
      }, 2000);
    }
    
    // Check if we went back to max_flow_start from max_flow_verify (timeout/failed verification)
    if (stateMachineState === 'max_flow_start' && flowStabilising) {
      // Show failure message
      setMaxFlowVerifying(false);
      setMaxFlowVerified(false);
      setFlowFailed(true);
      setFlowStabilising(false);
      setIsTestRunning(false);
      // After showing red X for 2 seconds, reset to Accept button
      setTimeout(() => {
        setFlowFailed(false);
        setMaxFlowConfirmed(false);
      }, 2000);
    }
  }, [stateMachineState, maxFlowVerifying, flowStabilising]);

  // Watch state machine for flow accuracy verification/stabilization outcomes
  useEffect(() => {
    // Track when we're in the verify state
    if (stateMachineState === 'flow_accuracy_verify') {
      setFlowAccuracyStabilising(true);
    }
    
    // Check if we just entered flow_accuracy_stabilise from flow_accuracy_verify (successful verification)
    if (stateMachineState === 'flow_accuracy_stabilise' && flowAccuracyVerifying && flowAccuracyStabilising) {
      setFlowAccuracyVerifying(false);
      setFlowAccuracyVerified(true);
      setFlowAccuracyStabilising(false);
      // After showing green tick for 2 seconds, clear it
      setTimeout(() => {
        setFlowAccuracyVerified(false);
      }, 2000);
    }
    
    // Check if we went back to flow_accuracy_start from flow_accuracy_verify (timeout/failed verification)
    if (stateMachineState === 'flow_accuracy_start' && flowAccuracyStabilising) {
      // Show failure message
      setFlowAccuracyVerifying(false);
      setFlowAccuracyVerified(false);
      setFlowAccuracyFailed(true);
      setFlowAccuracyStabilising(false);
      setIsTestRunning(false);
      // After showing red X for 2 seconds, reset to Accept button
      setTimeout(() => {
        setFlowAccuracyFailed(false);
        setFlowAccuracyConfirmed(false);
      }, 2000);
    }
  }, [stateMachineState, flowAccuracyVerifying, flowAccuracyStabilising]);

  // Handle test completion - stay in end state until report generation is successful
  // Auto-trigger report generation the moment the pump-stop / test-complete fires,
  // so the user sees "Generating report..." without needing to click a button.
  useEffect(() => {
    if (
      maxPressureComplete &&
      currentTestView === 'max_pressure' &&
      !isLoadingReport &&
      !reportUrl &&
      !reportError
    ) {
      handleGenerateReport('max_pressure');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPressureComplete, currentTestView, isLoadingReport, reportUrl, reportError]);

  useEffect(() => {
    if (maxPressureComplete && reportUrl) {
      // Acknowledge backend once the report is ready so it can move on in auto flows.
      sendMessage({ type: 'test', command: 'acknowledge_pressure_complete' });

      // Auto-mode chains into the next test — navigate back automatically.
      // Standalone max_pressure waits for the user's Back button.
      if (currentTestView === 'auto') {
        resetTestProgress();
      }
    }
  }, [maxPressureComplete, reportUrl, currentTestView, resetTestProgress, sendMessage]);

  // Handle max flow test completion - stay in end state until report generation is successful
  useEffect(() => {
    if (maxFlowComplete && reportUrl) {
      // Only reset to 'none' after report has been successfully generated
      // Notify backend that frontend has finished showing completion message
      sendMessage({ type: 'test', command: 'acknowledge_flow_complete' });
      
      if (currentTestView === 'max_flow') {
        setCurrentTestView('none');
        resetTestProgress();
        setIsTestRunning(false);
      }
      
      // Reset test-specific flags
      setMaxFlowConfirmed(false);
      setMaxFlowVerifying(false);
      setMaxFlowVerified(false);
    }
  }, [maxFlowComplete, reportUrl, currentTestView, setCurrentTestView, resetTestProgress, sendMessage]);

  // Handle flow accuracy test completion - stay in end state until report generation is successful
  useEffect(() => {
    if (flowAccuracyComplete && reportUrl) {
      // Only reset to 'none' after report has been successfully generated
      // Notify backend that frontend has finished showing completion message
      sendMessage({ type: 'test', command: 'acknowledge_flow_accuracy_complete' });
      
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
      setFlowAccuracyFailed(false);
      setFlowAccuracyStabilising(false);
    }
  }, [flowAccuracyComplete, reportUrl, currentTestView, setCurrentTestView, resetTestProgress, sendMessage]);

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
          serialNumber: selectedPump.serialNumber,
          maxRPM: selectedPump.maxRPM,
          maxFlowRate: selectedPump.maxFlowRate,
          maxPressure: selectedPump.maxPressure,
          currentDraw: selectedPump.currentDraw,
          strokeLength: selectedPump.strokeLength,
          supplyVoltage: selectedPump.supplyVoltage || '24VDC',
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
      // Notify other clients
      sendMessage({ type: 'pump', command: 'select_pump', pumpId });
      sendMessage({ type: 'input_activity', elementId: 'pump_select' });
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
    sendMessage({ type: 'input_activity', elementId: `test_${testType}` });
    
    // Reset progress when starting a new test
    resetTestProgress();
    // Clear report state when starting a new test
    clearReportState();
    
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
    setMaxFlowVerified(false);
    setFlowAccuracyVerified(false);
    setPressureFailed(false);
    setFlowFailed(false);
    setFlowAccuracyFailed(false);
    setPressureStabilising(false);
    setFlowStabilising(false);
    setFlowAccuracyStabilising(false);
  };

  const handleCancelTest = () => {
    // Send message to cancel test
    sendMessage({ type: 'test', command: 'cancel_test' });
    sendMessage({ type: 'input_activity', elementId: 'cancel_test' });
    
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
    setMaxFlowVerified(false);
    setFlowAccuracyVerified(false);
    setPressureFailed(false);
    setFlowFailed(false);
    setFlowAccuracyFailed(false);
    setPressureStabilising(false);
    setFlowStabilising(false);
    setFlowAccuracyStabilising(false);
    setIsTestRunning(false);
    // Reset progress bars
    resetTestProgress();
    // Clear report state
    clearReportState();
  };

  const handleConfirmValves = () => {
    // Determine which test to confirm based on currentTestView or stateMachineState (for auto mode)
    const testToConfirm = currentTestView === 'auto'
      ? (stateMachineState.includes('max_pressure') ? 'max_pressure'
         : stateMachineState.includes('max_flow') && !stateMachineState.includes('flow_accuracy') ? 'max_flow'
         : stateMachineState.includes('flow_accuracy') ? 'flow_accuracy'
         : null)
      : currentTestView;

    sendMessage({ type: 'input_activity', elementId: `confirm_${testToConfirm}` });

    if (testToConfirm === 'max_pressure') {
      setMaxPressureConfirmed(true);
      setMaxPressureVerifying(true);
      setIsTestRunning(true);
      // Send confirmation to backend with target pressure
      sendMessage({ 
        type: 'test', 
        command: 'confirm_pressure_test',
        target_pressure: selectedPump?.maxPressure
      });
      // State machine will handle stabilization - no setTimeout needed
    } else if (testToConfirm === 'max_flow') {
      setMaxFlowConfirmed(true);
      setMaxFlowVerifying(true);
      setIsTestRunning(true);
      // Send confirmation to backend with target pressure (for calculating 20% as flow target)
      sendMessage({ 
        type: 'test', 
        command: 'confirm_flow_test',
        target_pressure: selectedPump?.maxPressure
      });
      // State machine will handle verification - no setTimeout needed
    } else if (testToConfirm === 'flow_accuracy') {
      setFlowAccuracyConfirmed(true);
      setFlowAccuracyVerifying(true);
      setIsTestRunning(true);
      // Send confirmation to backend with target pressure and max flow rate
      sendMessage({ 
        type: 'test', 
        command: 'confirm_flow_accuracy_test',
        target_pressure: selectedPump?.maxPressure,
        max_flow_rate: selectedPump?.maxFlowRate
      });
      // State machine will handle verification - no setTimeout needed
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
    sendMessage({ type: 'input_activity', elementId: 'continue_pump_info' });
    // Update the selected pump with edited values before continuing
    if (selectedPump && editablePumpData) {
      const updatedPump = {
        ...selectedPump,
        ...editablePumpData,
      };
      setSelectedPump(updatedPump);
      // Send pump parameters to server
      const params = {
        name: editablePumpData.name,
        model: editablePumpData.model,
        serial_number: editablePumpData.serialNumber,
        max_rpm: editablePumpData.maxRPM,
        max_flow_rate: editablePumpData.maxFlowRate,
        max_pressure: editablePumpData.maxPressure,
        current_draw: editablePumpData.currentDraw,
        stroke_length: editablePumpData.strokeLength,
        supply_voltage: editablePumpData.supplyVoltage,
      };
      sendMessage({ 
        type: 'pump', 
        command: 'set_pump_params', 
        params 
      });

    }
    // Set showPumpInfoView to false - the ref will prevent useEffect from resetting it
    setShowPumpInfoView(false);
  };

  const handlePumpDataChange = (field: string, value: string | number) => {
    if (!editablePumpData) return;
    
    setEditablePumpData({
      ...editablePumpData,
      [field]: value === '' ? undefined : (typeof value === 'string' && field !== 'name' && field !== 'model' && field !== 'serialNumber' && field !== 'supplyVoltage' ? parseFloat(value) || undefined : value),
    });
  };

  // Generate a test ID based on current timestamp and test type
  const generateTestId = (testType: string): string => {
    const timestamp = Date.now();
    const testPrefix = testType.replace('_', '-');
    return `${testPrefix}-${timestamp}`;
  };

  // Handle report generation
  const handleGenerateReport = async (testType: string) => {
    const testId = generateTestId(testType);
    await finalizeTestAndGenerateReport(testId);
  };

  // Return to the test-selection menu after the user has finished with a report.
  const handleBackToTestMenu = () => {
    setCurrentTestView('none');
    setIsTestRunning(false);
    setMaxPressureConfirmed(false);
    setMaxFlowConfirmed(false);
    setFlowAccuracyConfirmed(false);
    setMaxPressureVerifying(false);
    setMaxFlowVerifying(false);
    setFlowAccuracyVerifying(false);
    setMaxFlowVerified(false);
    setFlowAccuracyVerified(false);
    setPressureFailed(false);
    setFlowFailed(false);
    setFlowAccuracyFailed(false);
    setPressureStabilising(false);
    setFlowStabilising(false);
    setFlowAccuracyStabilising(false);
    resetTestProgress();
    clearReportState();
  };

  // Render report generation UI
  const renderReportGenerationUI = (testType: string) => {
    if (isLoadingReport) {
      return (
        <div className="report-generation-section">
          <div className="loading-spinner"></div>
          <p className="report-message">Generating report...</p>
        </div>
      );
    }

    if (reportError) {
      return (
        <div className="report-generation-section">
          <div className="error-cross">✗</div>
          <p className="report-message error">{reportError}</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              clearReportState();
              handleGenerateReport(testType);
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    if (reportUrl) {
      return (
        <div className="report-generation-section">
          <p className="report-message">Report generated successfully</p>
          <div className="report-actions">
            <a
              href={reportUrl}
              download
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download Report
            </a>
            <button
              className="btn btn-secondary"
              onClick={handleBackToTestMenu}
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="report-generation-section">
        <button
          className="btn btn-primary"
          onClick={() => handleGenerateReport(testType)}
        >
          Generate Report
        </button>
      </div>
    );
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
              data-element-id="pump_select"
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
          
          <div className="pump-info-form-group">
            <label htmlFor="pump-serial-number" className="pump-info-form-label">Serial Number:</label>
            <input
              id="pump-serial-number"
              type="text"
              className="pump-info-form-input"
              value={editablePumpData.serialNumber || ''}
              onChange={(e) => handlePumpDataChange('serialNumber', e.target.value)}
              placeholder="Enter serial number"
            />
          </div>
          
          <div className="pump-info-form-group">
            <label htmlFor="pump-supply-voltage" className="pump-info-form-label">Supply Voltage:</label>
            <select
              id="pump-supply-voltage"
              className="pump-info-form-input"
              value={editablePumpData.supplyVoltage || '24VDC'}
              onChange={(e) => handlePumpDataChange('supplyVoltage', e.target.value)}
            >
              <option value="24VDC">24VDC</option>
              <option value="12VDC">12VDC</option>
              <option value="240VAC">240VAC</option>
            </select>
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
                <span className="pump-info-unit">L/Hr</span>
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
            data-element-id="continue_pump_info"
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
                <span className="pump-detail-value">{selectedPump.maxFlowRate} L/Hr</span>
              </div>
            )}
            {selectedPump.maxPressure !== undefined && (
              <div className="pump-detail-item">
                <span className="pump-detail-label">Max Pressure:</span>
                <span className="pump-detail-value">{selectedPump.maxPressure} PSI</span>
              </div>
            )}
            {selectedPump.supplyVoltage && (
              <div className="pump-detail-item">
                <span className="pump-detail-label">Supply Voltage:</span>
                <span className="pump-detail-value">{selectedPump.supplyVoltage}</span>
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
                data-element-id="test_auto"
              >
                Auto
              </button>
              <button
                className="btn btn-test"
                onClick={() => handleTestButtonClick('max_pressure')}
                data-element-id="test_max_pressure"
              >
                Max Pressure
              </button>
              <button
                className="btn btn-test"
                onClick={() => handleTestButtonClick('max_flow')}
                data-element-id="test_max_flow"
              >
                Max Flow
              </button>
              <button
                className="btn btn-test"
                onClick={() => handleTestButtonClick('flow_accuracy')}
                data-element-id="test_flow_accuracy"
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
                data-element-id="cancel_test"
              >
                Cancel Test
              </button>
            </div>
            {currentTestView === 'auto' && (
              <>
                {/* Show Max Pressure Test UI when in max_pressure states */}
                {(stateMachineState === 'max_pressure_start' || stateMachineState === 'max_pressure_verify' || stateMachineState === 'max_pressure_stabilise' || stateMachineState === 'max_pressure_run' || stateMachineState === 'max_pressure_end') && (
                  <>
                    <div className="test-view" key="auto-max-pressure-view">
                      {maxPressureComplete ? (
                        <div className="test-completion-section">
                          <div className="success-checkmark">✓</div>
                          <p className="completion-message">Pressure Test Complete</p>
                          {renderReportGenerationUI('max_pressure')}
                        </div>
                      ) : !maxPressureConfirmed ? (
                        <div className="test-confirmation-section">
                          <p className="confirmation-message">
                            Please confirm the valves and relief have been set.
                            <br />
                            <strong>Please ensure that pressure has been set to {selectedPump?.maxPressure || 'N/A'} PSI.</strong>
                          </p>
                          <button
                            className="btn btn-primary btn-confirm"
                            onClick={handleConfirmValves}
                            data-element-id="confirm_max_pressure"
                          >
                            Accept
                          </button>
                        </div>
                      ) : maxPressureVerifying ? (
                        <div className="test-verification-section">
                          <div className="loading-spinner"></div>
                          <p className="verification-message">
                            <strong>Stage {maxPressureVerifyStatus.stageNumber} of 3 — </strong>
                            {maxPressureVerifyStatus.stage === 'checking' && 'Checking pressure is building'}
                            {maxPressureVerifyStatus.stage === 'building' && 'Pressure is building'}
                            {maxPressureVerifyStatus.stage === 'stabilising' && 'Pressure is stabilising'}
                          </p>
                          <p className="verification-detail">
                            {maxPressureVerifyStatus.stage === 'checking' && (
                              <>
                                Waiting for pressure to rise{' '}
                                <strong>
                                  {(maxPressureVerifyStatus.growth ?? 0).toFixed(1)} /{' '}
                                  {(maxPressureVerifyStatus.growthTarget ?? 0).toFixed(1)} PSI
                                </strong>
                                {maxPressureVerifyStatus.current !== null && (
                                  <> (current {maxPressureVerifyStatus.current.toFixed(1)} PSI)</>
                                )}
                              </>
                            )}
                            {maxPressureVerifyStatus.stage === 'building' && (
                              <>
                                Pressure climbing — now{' '}
                                <strong>{(maxPressureVerifyStatus.current ?? 0).toFixed(1)} PSI</strong>
                                {maxPressureVerifyStatus.peak !== null && (
                                  <> (peak {maxPressureVerifyStatus.peak.toFixed(1)} PSI)</>
                                )}
                              </>
                            )}
                            {maxPressureVerifyStatus.stage === 'stabilising' && (
                              <>
                                Holding at{' '}
                                <strong>{(maxPressureVerifyStatus.peak ?? 0).toFixed(1)} PSI</strong>
                                {' '}— stable for{' '}
                                <strong>
                                  {(maxPressureVerifyStatus.timeStable ?? 0).toFixed(1)}s /{' '}
                                  {maxPressureVerifyStatus.stabiliseWindow.toFixed(1)}s
                                </strong>
                              </>
                            )}
                          </p>
                          {maxPressureVerifyStatus.warning && (
                            <p className="verification-warning">
                              Pump is not building pressure — are you sure the pump is bled correctly?
                            </p>
                          )}
                        </div>
                      ) : pressureFailed ? (
                        <div className="test-verification-section">
                          <div className="error-cross">✗</div>
                          <p className="verification-message error">Pressure not reached</p>
                        </div>
                      ) : (stateMachineState === 'max_pressure_stabilise' || stateMachineState === 'max_pressure_run') ? (
                        <div className="test-verification-section">
                          <div className="loading-spinner"></div>
                          <p className="verification-message">
                            <strong>Stage 3 of 3 — </strong>Pressure is stabilising
                          </p>
                        </div>
                      ) : (
                        <div className="test-run-section">
                          <p className="test-run-message">Preparing test...</p>
                        </div>
                      )}
                    </div>
                    {/* Unified Stage 3 progress: stabilise + run are 10s each. */}
                    {isTestRunning &&
                      (stateMachineState === 'max_pressure_stabilise' || stateMachineState === 'max_pressure_run') && (() => {
                        const unified = stateMachineState === 'max_pressure_stabilise'
                          ? maxPressureStabiliseProgress * 0.5
                          : 50 + maxPressureProgress * 0.5;
                        return (
                          <div className="test-progress-container">
                            <div className="test-progress-bar">
                              <div
                                className="test-progress-fill"
                                style={{ width: `${unified}%` }}
                              ></div>
                            </div>
                            <p className="test-progress-text">{unified.toFixed(1)}%</p>
                          </div>
                        );
                      })()}
                  </>
                )}
                
                {/* Show Max Flow Test UI when in max_flow states */}
                {(stateMachineState === 'max_flow_start' || stateMachineState === 'max_flow_verify' || stateMachineState === 'max_flow_stabilise' || stateMachineState === 'max_flow_run' || stateMachineState === 'max_flow_end') && (
                  <>
                    <div className="test-view" key="auto-max-flow-view">
                      {maxFlowComplete ? (
                        <div className="test-completion-section">
                          <div className="success-checkmark">✓</div>
                          <p className="completion-message">Flow Test Complete</p>
                          {renderReportGenerationUI('max_flow')}
                        </div>
                      ) : !maxFlowConfirmed ? (
                        <div className="test-confirmation-section">
                          <p className="confirmation-message">
                            Please confirm the valves and relief have been set.
                            <br />
                            <strong>Please ensure that pressure has been set to {selectedPump?.maxPressure ? (selectedPump.maxPressure * 0.2).toFixed(1) : 'N/A'} PSI (20% of max pressure).</strong>
                          </p>
                          <button
                            className="btn btn-primary btn-confirm"
                            onClick={handleConfirmValves}
                            data-element-id="confirm_max_flow"
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
                          <p className="verification-message">Flow verified</p>
                        </div>
                      ) : flowFailed ? (
                        <div className="test-verification-section">
                          <div className="error-cross">✗</div>
                          <p className="verification-message error">Flow not reached</p>
                        </div>
                      ) : stateMachineState === 'max_flow_stabilise' ? (
                        <div className="test-run-section">
                          <p className="test-run-message">Flow stabilising...</p>
                        </div>
                      ) : stateMachineState === 'max_flow_run' ? (
                        <div className="test-run-section">
                          <p className="test-run-message">Running test...</p>
                        </div>
                      ) : (
                        <div className="test-run-section">
                          <p className="test-run-message">Preparing test...</p>
                        </div>
                      )}
                    </div>
                    {/* Progress bar for stabilise phase */}
                    {isTestRunning && stateMachineState === 'max_flow_stabilise' && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${maxFlowStabiliseProgress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{maxFlowStabiliseProgress.toFixed(1)}%</p>
                      </div>
                    )}
                    {/* Progress bar for run phase */}
                    {isTestRunning && stateMachineState === 'max_flow_run' && (
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
                {(stateMachineState === 'flow_accuracy_start' || stateMachineState === 'flow_accuracy_verify' || stateMachineState === 'flow_accuracy_stabilise' || stateMachineState === 'flow_accuracy_phase1' || stateMachineState === 'flow_accuracy_phase2' || stateMachineState === 'flow_accuracy_phase3' || stateMachineState === 'flow_accuracy_end') && (
                  <>
                    <div className="test-view" key="auto-flow-accuracy-view">
                      {flowAccuracyComplete ? (
                        <div className="test-completion-section">
                          <div className="success-checkmark">✓</div>
                          <p className="completion-message">Flow Accuracy Test Complete</p>
                          {renderReportGenerationUI('flow_accuracy')}
                        </div>
                      ) : !flowAccuracyConfirmed ? (
                        <div className="test-confirmation-section">
                          <p className="confirmation-message">
                            Please confirm the valves and relief have been set.
                            <br />
                            <strong>Please ensure that pressure has been set to {selectedPump?.maxPressure ? (selectedPump.maxPressure * 0.2).toFixed(1) : 'N/A'} PSI (20% of max pressure).</strong>
                          </p>
                          <button
                            className="btn btn-primary btn-confirm"
                            onClick={handleConfirmValves}
                            data-element-id="confirm_flow_accuracy"
                          >
                            Accept
                          </button>
                        </div>
                      ) : flowAccuracyVerifying ? (
                        <div className="test-verification-section">
                          <div className="loading-spinner"></div>
                          <p className="verification-message">Verifying pressure...</p>
                        </div>
                      ) : flowAccuracyVerified ? (
                        <div className="test-verification-section">
                          <div className="success-checkmark">✓</div>
                          <p className="verification-message">Pressure verified</p>
                        </div>
                      ) : flowAccuracyFailed ? (
                        <div className="test-verification-section">
                          <div className="error-cross">✗</div>
                          <p className="verification-message error">Pressure not reached</p>
                        </div>
                      ) : stateMachineState === 'flow_accuracy_stabilise' ? (
                        <div className="test-run-section">
                          <p className="test-run-message">Flow stabilising...</p>
                        </div>
                      ) : stateMachineState === 'flow_accuracy_phase1' ? (
                        <div className="test-run-section">
                          <p className="test-run-message">10% Flow Rate...</p>
                        </div>
                      ) : stateMachineState === 'flow_accuracy_phase2' ? (
                        <div className="test-run-section">
                          <p className="test-run-message">50% Flow Rate...</p>
                        </div>
                      ) : stateMachineState === 'flow_accuracy_phase3' ? (
                        <div className="test-run-section">
                          <p className="test-run-message">100% Flow Rate...</p>
                        </div>
                      ) : (
                        <div className="test-run-section">
                          <p className="test-run-message">Preparing test...</p>
                        </div>
                      )}
                    </div>
                    {/* Progress bar for stabilise phase */}
                    {isTestRunning && stateMachineState === 'flow_accuracy_stabilise' && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${flowAccuracyStabiliseProgress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{flowAccuracyStabiliseProgress.toFixed(1)}%</p>
                      </div>
                    )}
                    {/* Progress bar for phase 1 */}
                    {isTestRunning && stateMachineState === 'flow_accuracy_phase1' && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${flowAccuracyPhase1Progress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{flowAccuracyPhase1Progress.toFixed(1)}%</p>
                      </div>
                    )}
                    {/* Progress bar for phase 2 */}
                    {isTestRunning && stateMachineState === 'flow_accuracy_phase2' && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${flowAccuracyPhase2Progress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{flowAccuracyPhase2Progress.toFixed(1)}%</p>
                      </div>
                    )}
                    {/* Progress bar for phase 3 */}
                    {isTestRunning && stateMachineState === 'flow_accuracy_phase3' && (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div 
                            className="test-progress-fill" 
                            style={{ width: `${flowAccuracyPhase3Progress}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{flowAccuracyPhase3Progress.toFixed(1)}%</p>
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
                      <p className="completion-message">Pressure Test Complete</p>
                      {renderReportGenerationUI('max_pressure')}
                    </div>
                  ) : !maxPressureConfirmed ? (
                    <div className="test-confirmation-section">
                      <p className="confirmation-message">
                        Please confirm the valves and relief have been set.
                        <br />
                        <strong>Please ensure that pressure has been set to {selectedPump?.maxPressure || 'N/A'} PSI.</strong>
                      </p>
                      <button
                        className="btn btn-primary btn-confirm"
                        onClick={handleConfirmValves}
                        data-element-id="confirm_max_pressure"
                      >
                        Accept
                      </button>
                    </div>
                  ) : maxPressureVerifying ? (
                    <div className="test-verification-section">
                      <div className="loading-spinner"></div>
                      <p className="verification-message">
                        <strong>Stage {maxPressureVerifyStatus.stageNumber} of 3 — </strong>
                        {maxPressureVerifyStatus.stage === 'checking' && 'Checking pressure is building'}
                        {maxPressureVerifyStatus.stage === 'building' && 'Pressure is building'}
                        {maxPressureVerifyStatus.stage === 'stabilising' && 'Pressure is stabilising'}
                      </p>
                      <p className="verification-detail">
                        {maxPressureVerifyStatus.stage === 'checking' && (
                          <>
                            Waiting for pressure to rise{' '}
                            <strong>
                              {(maxPressureVerifyStatus.growth ?? 0).toFixed(1)} /{' '}
                              {(maxPressureVerifyStatus.growthTarget ?? 0).toFixed(1)} PSI
                            </strong>
                            {maxPressureVerifyStatus.current !== null && (
                              <> (current {maxPressureVerifyStatus.current.toFixed(1)} PSI)</>
                            )}
                          </>
                        )}
                        {maxPressureVerifyStatus.stage === 'building' && (
                          <>
                            Pressure climbing — now{' '}
                            <strong>{(maxPressureVerifyStatus.current ?? 0).toFixed(1)} PSI</strong>
                            {maxPressureVerifyStatus.peak !== null && (
                              <> (peak {maxPressureVerifyStatus.peak.toFixed(1)} PSI)</>
                            )}
                          </>
                        )}
                        {maxPressureVerifyStatus.stage === 'stabilising' && (
                          <>
                            Holding at{' '}
                            <strong>{(maxPressureVerifyStatus.peak ?? 0).toFixed(1)} PSI</strong>
                            {' '}— stable for{' '}
                            <strong>
                              {(maxPressureVerifyStatus.timeStable ?? 0).toFixed(1)}s /{' '}
                              {maxPressureVerifyStatus.stabiliseWindow.toFixed(1)}s
                            </strong>
                          </>
                        )}
                      </p>
                      {maxPressureVerifyStatus.warning && (
                        <p className="verification-warning">
                          Pump is not building pressure — are you sure the pump is bled correctly?
                        </p>
                      )}
                    </div>
                  ) : pressureFailed ? (
                    <div className="test-verification-section">
                      <div className="error-cross">✗</div>
                      <p className="verification-message error">Pressure not reached</p>
                    </div>
                  ) : (stateMachineState === 'max_pressure_stabilise' || stateMachineState === 'max_pressure_run') ? (
                    <div className="test-verification-section">
                      <div className="loading-spinner"></div>
                      <p className="verification-message">
                        <strong>Stage 3 of 3 — </strong>Pressure is stabilising
                      </p>
                    </div>
                  ) : (
                    <div className="test-run-section">
                      <p className="test-run-message">Preparing test...</p>
                    </div>
                  )}
                </div>
                {/* Unified Stage 3 progress: stabilise + run are 10s each, so each
                    phase is half of the combined bar. */}
                {isTestRunning && currentTestView === 'max_pressure' &&
                  (stateMachineState === 'max_pressure_stabilise' || stateMachineState === 'max_pressure_run') && (() => {
                    const unified = stateMachineState === 'max_pressure_stabilise'
                      ? maxPressureStabiliseProgress * 0.5
                      : 50 + maxPressureProgress * 0.5;
                    return (
                      <div className="test-progress-container">
                        <div className="test-progress-bar">
                          <div
                            className="test-progress-fill"
                            style={{ width: `${unified}%` }}
                          ></div>
                        </div>
                        <p className="test-progress-text">{unified.toFixed(1)}%</p>
                      </div>
                    );
                  })()}
              </>
            )}
            {currentTestView === 'max_flow' && (
              <>
                <div className="test-view" key="max-flow-view">
                  {maxFlowComplete ? (
                    <div className="test-completion-section">
                      <div className="success-checkmark">✓</div>
                      <p className="completion-message">Flow Test Complete</p>
                      {renderReportGenerationUI('max_flow')}
                    </div>
                  ) : !maxFlowConfirmed ? (
                    <div className="test-confirmation-section">
                      <p className="confirmation-message">
                        Please confirm the valves and relief have been set.
                        <br />
                        <strong>Please ensure that pressure has been set to {selectedPump?.maxPressure ? (selectedPump.maxPressure * 0.2).toFixed(1) : 'N/A'} PSI (20% of max pressure).</strong>
                      </p>
                      <button
                        className="btn btn-primary btn-confirm"
                        onClick={handleConfirmValves}
                        data-element-id="confirm_max_flow"
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
                      <p className="verification-message">Flow verified</p>
                    </div>
                  ) : flowFailed ? (
                    <div className="test-verification-section">
                      <div className="error-cross">✗</div>
                      <p className="verification-message error">Flow not reached</p>
                    </div>
                  ) : stateMachineState === 'max_flow_stabilise' ? (
                    <div className="test-run-section">
                      <p className="test-run-message">Flow stabilising...</p>
                    </div>
                  ) : stateMachineState === 'max_flow_run' ? (
                    <div className="test-run-section">
                      <p className="test-run-message">Running test...</p>
                    </div>
                  ) : (
                    <div className="test-run-section">
                      <p className="test-run-message">Preparing test...</p>
                    </div>
                  )}
                </div>
                {/* Progress bar for stabilise phase */}
                {isTestRunning && currentTestView === 'max_flow' && stateMachineState === 'max_flow_stabilise' && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${maxFlowStabiliseProgress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{maxFlowStabiliseProgress.toFixed(1)}%</p>
                  </div>
                )}
                {/* Progress bar for run phase */}
                {isTestRunning && currentTestView === 'max_flow' && stateMachineState === 'max_flow_run' && (
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
                      {renderReportGenerationUI('flow_accuracy')}
                    </div>
                  ) : !flowAccuracyConfirmed ? (
                    <div className="test-confirmation-section">
                      <p className="confirmation-message">
                        Please confirm the valves and relief have been set.
                        <br />
                        <strong>Please ensure that pressure has been set to {selectedPump?.maxPressure ? (selectedPump.maxPressure * 0.2).toFixed(1) : 'N/A'} PSI (20% of max pressure).</strong>
                      </p>
                      <button
                        className="btn btn-primary btn-confirm"
                        onClick={handleConfirmValves}
                        data-element-id="confirm_flow_accuracy"
                      >
                        Accept
                      </button>
                    </div>
                  ) : flowAccuracyVerifying ? (
                    <div className="test-verification-section">
                      <div className="loading-spinner"></div>
                      <p className="verification-message">Verifying pressure...</p>
                    </div>
                  ) : flowAccuracyVerified ? (
                    <div className="test-verification-section">
                      <div className="success-checkmark">✓</div>
                      <p className="verification-message">Pressure verified</p>
                    </div>
                  ) : flowAccuracyFailed ? (
                    <div className="test-verification-section">
                      <div className="error-cross">✗</div>
                      <p className="verification-message error">Pressure not reached</p>
                    </div>
                  ) : stateMachineState === 'flow_accuracy_stabilise' ? (
                    <div className="test-run-section">
                      <p className="test-run-message">Flow stabilising...</p>
                    </div>
                  ) : stateMachineState === 'flow_accuracy_phase1' ? (
                    <div className="test-run-section">
                      <p className="test-run-message">10% Flow Rate...</p>
                    </div>
                  ) : stateMachineState === 'flow_accuracy_phase2' ? (
                    <div className="test-run-section">
                      <p className="test-run-message">50% Flow Rate...</p>
                    </div>
                  ) : stateMachineState === 'flow_accuracy_phase3' ? (
                    <div className="test-run-section">
                      <p className="test-run-message">100% Flow Rate...</p>
                    </div>
                  ) : (
                    <div className="test-run-section">
                      <p className="test-run-message">Preparing test...</p>
                    </div>
                  )}
                </div>
                {/* Progress bar for stabilise phase */}
                {isTestRunning && currentTestView === 'flow_accuracy' && stateMachineState === 'flow_accuracy_stabilise' && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${flowAccuracyStabiliseProgress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{flowAccuracyStabiliseProgress.toFixed(1)}%</p>
                  </div>
                )}
                {/* Progress bar for phase 1 */}
                {isTestRunning && currentTestView === 'flow_accuracy' && stateMachineState === 'flow_accuracy_phase1' && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${flowAccuracyPhase1Progress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{flowAccuracyPhase1Progress.toFixed(1)}%</p>
                  </div>
                )}
                {/* Progress bar for phase 2 */}
                {isTestRunning && currentTestView === 'flow_accuracy' && stateMachineState === 'flow_accuracy_phase2' && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${flowAccuracyPhase2Progress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{flowAccuracyPhase2Progress.toFixed(1)}%</p>
                  </div>
                )}
                {/* Progress bar for phase 3 */}
                {isTestRunning && currentTestView === 'flow_accuracy' && stateMachineState === 'flow_accuracy_phase3' && (
                  <div className="test-progress-container">
                    <div className="test-progress-bar">
                      <div 
                        className="test-progress-fill" 
                        style={{ width: `${flowAccuracyPhase3Progress}%` }}
                      ></div>
                    </div>
                    <p className="test-progress-text">{flowAccuracyPhase3Progress.toFixed(1)}%</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom Section: Manual Control */}
      <div className={`manual-control-section ${isExiting ? 'exiting' : ''}`}>
        <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Manual Control</span>
          <div>
            <span style={{ marginRight: '0.5rem', color: '#6b7280', fontWeight: 400 }}>Pump:</span>
            <span style={{ color: getPumpStateColor() }}>
              {pumpState ? pumpState.toUpperCase() : ''}
            </span>
          </div>
        </h3>
        {isTestInProgress ? (
          <div className="manual-control-disabled">
            <p className="disabled-message">
              Manual controls are disabled when a test is in progress.
            </p>
          </div>
        ) : (
          <div className={`manual-control-content ${manualControlExiting ? 'exiting' : ''}`}>

        <div className="control-row">
          <div className="button-group button-group-left">
            <button
              onClick={() => { startPump(); sendMessage({ type: 'input_activity', elementId: 'start_pump' }); }}
              disabled={connectionStatus !== 'connected' || pumpState === 'on'}
              className="btn btn-primary btn-narrow"
              data-element-id="start_pump"
            >
              Start
            </button>
            <button
              onClick={() => { stopPump(); sendMessage({ type: 'input_activity', elementId: 'stop_pump' }); }}
              disabled={connectionStatus !== 'connected' || pumpState === 'off'}
              className="btn btn-danger btn-narrow"
              data-element-id="stop_pump"
            >
              Stop
            </button>
          </div>

          <div className={`target-flow-control ${isFlowShaking ? 'flow-shake' : ''}`}>
            <label htmlFor="target-flow-input">Target Flow (L/Hr)</label>
            <div className="target-flow-input-group">
              <input
                type="range"
                id="target-flow-slider"
                min="0"
                max={selectedPump?.maxFlowRate ?? 100}
                step="0.1"
                value={localSliderValue}
                onChange={(e) => {
                  setLocalSliderValue(parseFloat(e.target.value));
                }}
                onMouseUp={() => commitFlowRate(localSliderValue)}
                onTouchEnd={() => commitFlowRate(localSliderValue)}
                className={`target-flow-slider ${isFlowPending ? 'flow-pending' : ''}`}
                data-element-id="set_target_flow"
              />
              <input
                type="number"
                id="target-flow-input"
                min="0"
                max={selectedPump?.maxFlowRate ?? 100}
                step="0.1"
                value={localSliderValue}
                onChange={(e) => {
                  setLocalSliderValue(parseFloat(e.target.value) || 0);
                }}
                onBlur={() => commitFlowRate(localSliderValue)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitFlowRate(localSliderValue);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className={`target-flow-input ${isFlowPending ? 'flow-pending' : ''}`}
                data-element-id="set_target_flow"
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
