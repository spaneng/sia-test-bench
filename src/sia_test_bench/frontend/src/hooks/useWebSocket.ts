import { useEffect, useRef } from 'react';
import { useTestBenchStore, type PumpData } from '../store/useTestBenchStore';

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.host}/ws`;
// Module-level flag to prevent multiple connections
let globalConnectionActive = false;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Prevent duplicate connections in React.StrictMode
    if (globalConnectionActive) {
      return;
    }
    globalConnectionActive = true;

    const { setConnectionStatus, addDataPoint, setPumpState, setSendMessage } = useTestBenchStore.getState();
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 3000;
    let shouldReconnect = true;

    const connect = () => {
      try {
        setConnectionStatus('connecting');
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          console.log('WebSocket connected');
          setConnectionStatus('connected');
          reconnectAttempts = 0;
          
          // Register sendMessage function in store
          setSendMessage((message: object) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(message));
            } else {
              console.warn('WebSocket is not connected');
            }
          });
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Handle different message types
            if (data.type === 'data') {
              const pumpData: PumpData = {
                timestamp: data.timestamp || Date.now(),
                pressure: data.pressure,
                tankLevel: data.tankLevel,
                flowRate: data.flowRate,
                currentDraw: data.currentDraw,
                pulseRate: data.pulseRate,
                valveState: data.valveState,
                temperature: data.temperature,
                voltage: data.voltage,
                current: data.current,
                ...data,
              };
              addDataPoint(pumpData);

              // Update pumpState if provided in data message - blindly follow backend value
              if (data.pumpState !== undefined && typeof data.pumpState === 'string') {
                setPumpState(data.pumpState);
              }
            } else if (data.type === 'state') {
              setPumpState(data.state);
              if (data.targetFlow !== undefined) {
                const { setTargetFlow } = useTestBenchStore.getState();
                setTargetFlow(data.targetFlow);
              }
            } else if (data.type === 'test_progress') {
              // Forward test progress to the store
              const { setTestProgress } = useTestBenchStore.getState();
              setTestProgress(data.test, data.progress);
            } else if (data.type === 'test_complete') {
              // Forward test completion to the store
              const { setTestComplete } = useTestBenchStore.getState();
              setTestComplete(data.test);
            } else if (data.type === 'state_machine') {
              // Forward state machine state to the store
              const { setStateMachineState } = useTestBenchStore.getState();
              setStateMachineState(data.state);
            } else if (data.type === 'pump_selected') {
              // Another client selected a pump
              const store = useTestBenchStore.getState();
              store.selectPumpById(data.pumpId);
            } else if (data.type === 'input_activity') {
              // Another client interacted with a control — flash it
              const store = useTestBenchStore.getState();
              store.setInputFlash(data.elementId);
              setTimeout(() => {
                useTestBenchStore.getState().setInputFlash(null);
              }, 500);
            } else if (data.type === 'pump_params_updated') {
              // Another client saved pump params — update local selectedPump
              const store = useTestBenchStore.getState();
              const params = data.params;
              if (store.selectedPump && params) {
                store.setSelectedPump({
                  ...store.selectedPump,
                  name: params.name ?? store.selectedPump.name,
                  model: params.model ?? store.selectedPump.model,
                  serialNumber: params.serial_number ?? store.selectedPump.serialNumber,
                  maxRPM: params.max_rpm ?? store.selectedPump.maxRPM,
                  maxFlowRate: params.max_flow_rate ?? store.selectedPump.maxFlowRate,
                  maxPressure: params.max_pressure ?? store.selectedPump.maxPressure,
                  currentDraw: params.current_draw ?? store.selectedPump.currentDraw,
                  strokeLength: params.stroke_length ?? store.selectedPump.strokeLength,
                });
              }
            } else if (data.type === 'session_snapshot') {
              // Apply full session snapshot on connect/reconnect
              const store = useTestBenchStore.getState();
              store.setPumpState(data.pumpState);
              store.setTargetFlow(data.targetFlow);
              store.setStateMachineState(data.stateMachineState);

              // Bulk-load data history
              if (data.dataHistory && data.dataHistory.length > 0) {
                store.setDataHistory(data.dataHistory);
              }

              // Apply progress values
              if (data.progress) {
                for (const [key, value] of Object.entries(data.progress)) {
                  store.setTestProgress(key, value as number);
                }
              }

              // Apply completion flags
              if (data.completion) {
                for (const test of Object.keys(data.completion)) {
                  store.setTestComplete(test);
                }
              }

              // Derive the correct test view from state machine state
              store.deriveTestViewFromState(data.stateMachineState);

              // Auto-select pump from snapshot (after pumps are loaded)
              if (data.selectedPumpId) {
                const trySelectPump = () => {
                  const s = useTestBenchStore.getState();
                  if (s.availablePumps.length > 0) {
                    s.selectPumpById(data.selectedPumpId);
                  } else {
                    // Pumps not loaded yet — retry shortly
                    setTimeout(trySelectPump, 100);
                  }
                };
                trySelectPump();
              }
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setConnectionStatus('error');
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
          setConnectionStatus('disconnected');
          
          // Attempt to reconnect only if not cleaning up
          if (shouldReconnect && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            reconnectTimeoutRef.current = window.setTimeout(() => {
              connect();
            }, reconnectDelay);
          } else if (!shouldReconnect) {
            // Cleanup initiated
          } else {
            setConnectionStatus('error');
          }
        };

        wsRef.current = ws;
      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        setConnectionStatus('error');
      }
    };

    connect();

    return () => {
      // Cleanup: prevent reconnections and close connection
      shouldReconnect = false;
      globalConnectionActive = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

}

