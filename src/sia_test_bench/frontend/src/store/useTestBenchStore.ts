import { create } from 'zustand';

export interface PumpData {
  timestamp: number;
  pressure?: number;
  tankLevel?: number;
  flowRate?: number;
  currentDraw?: number;
  pulseRate?: number;
  valveState?: number | boolean | string;
  temperature?: number;
  voltage?: number;
  current?: number;
  [key: string]: number | boolean | string | undefined;
}

export interface PumpType {
  id: string;
  name: string;
  model?: string;
  maxRPM?: number;
  maxFlowRate?: number;
  maxPressure?: number;
  currentDraw?: number;
  strokeLength?: number;
}

export type TestView = 'none' | 'auto' | 'max_pressure' | 'max_flow' | 'flow_accuracy';

export interface TestBenchState {
  // Connection state
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  
  // Pump selection state
  availablePumps: PumpType[];
  selectedPump: PumpType | null;
  isLoadingPumps: boolean;
  
  // Pump control state
  pumpState: 'off' | 'on' | 'warning_disabled';
  isRunning: boolean;
  targetFlow: number;
  
  // Test state
  currentTestView: TestView;
  stateMachineState: string;  // Backend state machine state (e.g., 'off', 'max_pressure_start', 'max_pressure_run', etc.)
  maxPressureStabiliseProgress: number;
  maxPressureProgress: number;
  maxFlowStabiliseProgress: number;
  maxFlowProgress: number;
  flowAccuracyProgress: number;
  maxPressureComplete: boolean;
  maxFlowComplete: boolean;
  flowAccuracyComplete: boolean;
  
  // Data
  dataHistory: PumpData[];
  latestData: PumpData | null;
  
  // Report generation state
  isLoadingReport: boolean;
  reportError: string | null;
  reportUrl: string | null;
  currentTestId: string | null;
  
  // Actions
  setConnectionStatus: (status: TestBenchState['connectionStatus']) => void;
  setPumpState: (state: TestBenchState['pumpState']) => void;
  setIsRunning: (running: boolean) => void;
  addDataPoint: (data: PumpData) => void;
  clearData: () => void;
  setSelectedPump: (pump: PumpType | null) => void;
  setCurrentTestView: (view: TestView) => void;
  setTargetFlow: (flow: number) => void;
  setStateMachineState: (state: string) => void;
  setTestProgress: (test: string, progress: number) => void;
  setTestComplete: (test: string) => void;
  resetTestProgress: () => void;
  fetchAvailablePumps: () => Promise<void>;
  sendMessage: (message: object) => void;
  setSendMessage: (fn: (message: object) => void) => void;
  
  // Control actions (these will trigger API calls)
  startPump: () => Promise<void>;
  stopPump: () => Promise<void>;
  setWarningDisabled: () => Promise<void>;
  setWarningEnabled: () => Promise<void>;
  
  // Report generation
  finalizeTestAndGenerateReport: (testId: string) => Promise<void>;
  clearReportState: () => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8092';
// const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.host}`;


export const useTestBenchStore = create<TestBenchState>((set, get) => ({
  // Initial state
  isConnected: false,
  connectionStatus: 'disconnected',
  availablePumps: [] as PumpType[],
  selectedPump: null,
  isLoadingPumps: false,
  pumpState: 'warning_disabled',
  isRunning: false,
  targetFlow: 0,
  currentTestView: 'none',
  stateMachineState: 'off',
  maxPressureStabiliseProgress: 0,
  maxPressureProgress: 0,
  maxFlowStabiliseProgress: 0,
  maxFlowProgress: 0,
  flowAccuracyProgress: 0,
  maxPressureComplete: false,
  maxFlowComplete: false,
  flowAccuracyComplete: false,
  dataHistory: [],
  latestData: null,
  isLoadingReport: false,
  reportError: null,
  reportUrl: null,
  currentTestId: null,
  
  // Setters
  setConnectionStatus: (status) => set({ 
    connectionStatus: status,
    isConnected: status === 'connected'
  }),
  
  setPumpState: (state) => set({ pumpState: state }),
  
  setIsRunning: (running) => set({ isRunning: running }),
  
  setSelectedPump: (pump) => set({ selectedPump: pump }),
  
  setCurrentTestView: (view) => set({ currentTestView: view }),
  
  setTargetFlow: (flow) => set({ targetFlow: flow }),
  
  setStateMachineState: (state) => set({ stateMachineState: state }),
  
  setTestProgress: (test, progress) => {
    if (test === 'max_pressure_stabilise') {
      set({ maxPressureStabiliseProgress: progress });
    } else if (test === 'max_pressure') {
      set({ maxPressureProgress: progress });
    } else if (test === 'max_flow_stabilise') {
      set({ maxFlowStabiliseProgress: progress });
    } else if (test === 'max_flow') {
      set({ maxFlowProgress: progress });
    } else if (test === 'flow_accuracy') {
      set({ flowAccuracyProgress: progress });
    }
  },
  
  setTestComplete: (test) => {
    if (test === 'max_pressure') {
      set({ maxPressureComplete: true, maxPressureProgress: 100 });
    } else if (test === 'max_flow') {
      set({ maxFlowComplete: true, maxFlowProgress: 100 });
    } else if (test === 'flow_accuracy') {
      set({ flowAccuracyComplete: true, flowAccuracyProgress: 100 });
    }
  },
  
  addDataPoint: (data) => {
    const currentHistory = get().dataHistory;
    const newHistory = [...currentHistory, data].slice(-1000); // Keep last 1000 points
    set({ 
      dataHistory: newHistory,
      latestData: data
    });
  },
  
  clearData: () => set({ dataHistory: [], latestData: null }),
  
  resetTestProgress: () => set({ 
    maxPressureStabiliseProgress: 0,
    maxPressureProgress: 0,
    maxFlowStabiliseProgress: 0,
    maxFlowProgress: 0,
    flowAccuracyProgress: 0,
    maxPressureComplete: false,
    maxFlowComplete: false,
    flowAccuracyComplete: false
  }),
  
  sendMessage: () => {
    console.warn('WebSocket not initialized yet');
  },
  
  setSendMessage: (fn) => set({ sendMessage: fn }),
  
  // Fetch available pumps from backend
  fetchAvailablePumps: async () => {
    set({ isLoadingPumps: true });
    try {
      // TODO: Replace with actual API endpoint
      const response = await fetch(`${API_URL}/api/pumps`);
      if (response.ok) {
        const pumps = await response.json();
        set({ availablePumps: pumps, isLoadingPumps: false });
      } else {
        // Fallback to mock data if API is not available
        const mockPumps: PumpType[] = [
          { 
            id: '1', 
            name: 'SIA Pump Model A', 
            model: 'Model A',
            maxRPM: 3000,
            maxFlowRate: 50,
            maxPressure: 100,
            currentDraw: 5.5,
            strokeLength: 2.5
          },
          { 
            id: '2', 
            name: 'SIA Pump Model B', 
            model: 'Model B',
            maxRPM: 3500,
            maxFlowRate: 75,
            maxPressure: 120,
            currentDraw: 7.2,
            strokeLength: 3.0
          },
          { 
            id: '3', 
            name: 'SIA Pump Model C', 
            model: 'Model C',
            maxRPM: 4000,
            maxFlowRate: 100,
            maxPressure: 150,
            currentDraw: 9.5,
            strokeLength: 3.5
          },
        ];
        set({ availablePumps: mockPumps, isLoadingPumps: false });
      }
    } catch (error) {
      console.error('Failed to fetch pumps:', error);
      // Fallback to mock data
      const mockPumps: PumpType[] = [
        { 
          id: '1', 
          name: 'SIA Pump Model A', 
          model: 'Model A',
          maxRPM: 3000,
          maxFlowRate: 50,
          maxPressure: 100,
          currentDraw: 5.5,
          strokeLength: 2.5
        },
        { 
          id: '2', 
          name: 'SIA Pump Model B', 
          model: 'Model B',
          maxRPM: 3500,
          maxFlowRate: 75,
          maxPressure: 120,
          currentDraw: 7.2,
          strokeLength: 3.0
        },
        { 
          id: '3', 
          name: 'SIA Pump Model C', 
          model: 'Model C',
          maxRPM: 4000,
          maxFlowRate: 100,
          maxPressure: 150,
          currentDraw: 9.5,
          strokeLength: 3.5
        },
      ];
      set({ availablePumps: mockPumps, isLoadingPumps: false });
    }
  },
  
  // Control actions
  startPump: async () => {
    try {
      const response = await fetch(`${API_URL}/api/pump/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json();
        set({ pumpState: data.state as 'on' | 'off' | 'warning_disabled', isRunning: data.state === 'on' });
      } else {
        console.error('Failed to start pump');
      }
    } catch (error) {
      console.error('Error starting pump:', error);
    }
  },
  
  stopPump: async () => {
    try {
      const response = await fetch(`${API_URL}/api/pump/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json();
        set({ pumpState: data.state as 'on' | 'off' | 'warning_disabled', isRunning: data.state === 'on' });
      } else {
        console.error('Failed to stop pump');
      }
    } catch (error) {
      console.error('Error stopping pump:', error);
    }
  },
  
  setWarningDisabled: async () => {
    // TODO: Call backend API
    set({ pumpState: 'warning_disabled' });
  },
  
  setWarningEnabled: async () => {
    // TODO: Call backend API
    const currentState = get().pumpState;
    if (currentState === 'warning_disabled') {
      set({ pumpState: 'off' });
    }
  },
  
  // Report generation
  finalizeTestAndGenerateReport: async (testId: string) => {
    const state = get();
    const { selectedPump, dataHistory } = state;
    
    if (!selectedPump) {
      set({ reportError: 'No pump selected' });
      return;
    }
    
    if (!dataHistory || dataHistory.length === 0) {
      set({ reportError: 'No test data available' });
      return;
    }
    
    // Set loading state
    set({ isLoadingReport: true, reportError: null, reportUrl: null, currentTestId: testId });
    
    try {
      // Extract timestamps and determine start/end
      const timestamps = dataHistory.map(d => d.timestamp).filter((ts): ts is number => ts !== undefined);
      if (timestamps.length === 0) {
        throw new Error('No valid timestamps in test data');
      }
      
      const startTimestamp = Math.min(...timestamps);
      const endTimestamp = Math.max(...timestamps);
      
      // Prepare series data - convert timestamps from milliseconds to seconds if needed
      // Check if timestamps are in milliseconds (greater than year 2000 timestamp in milliseconds)
      const isMilliseconds = startTimestamp > 946684800000; // Year 2000 in milliseconds (Unix: 946684800 seconds)
      const series = dataHistory.map(data => ({
        timestamp: isMilliseconds ? data.timestamp / 1000 : data.timestamp,
        pressure: data.pressure,
        flowRate: data.flowRate,
        // Include other fields if present
        tankLevel: data.tankLevel,
        currentDraw: data.currentDraw,
        pulseRate: data.pulseRate,
        temperature: data.temperature,
        voltage: data.voltage,
        current: data.current,
      }));
      
      // Prepare metadata
      const metadata = {
        pump_serial: selectedPump.id, // Use ID as serial placeholder
        pump_model: selectedPump.model || selectedPump.name,
        operator: '', // Placeholder - can be enhanced later
        site: '', // Placeholder - can be enhanced later
        start_timestamp: isMilliseconds ? startTimestamp / 1000 : startTimestamp,
        end_timestamp: isMilliseconds ? endTimestamp / 1000 : endTimestamp,
        pump_name: selectedPump.name,
      };
      
      // POST to finalize endpoint
      const response = await fetch(`${API_URL}/api/tests/${testId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          series,
          metadata,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'success') {
        // Store the full URL (relative path from API response)
        const fullReportUrl = result.report_url.startsWith('http') 
          ? result.report_url 
          : `${API_URL}${result.report_url}`;
        
        set({ 
          isLoadingReport: false, 
          reportUrl: fullReportUrl,
          reportError: null,
        });
      } else {
        throw new Error(result.error || 'Report generation failed');
      }
    } catch (error) {
      console.error('Error finalizing test:', error);
      set({ 
        isLoadingReport: false, 
        reportError: error instanceof Error ? error.message : 'Failed to generate report',
        reportUrl: null,
      });
    }
  },
  
  clearReportState: () => set({ 
    isLoadingReport: false, 
    reportError: null, 
    reportUrl: null, 
    currentTestId: null 
  }),
}));

