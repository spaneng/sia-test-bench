import { useEffect, useRef } from 'react';
import { useTestBenchStore, type PumpData } from '../store/useTestBenchStore';

// const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.host}/ws`;
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8092/ws';
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

