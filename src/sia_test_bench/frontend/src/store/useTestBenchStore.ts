import { create } from 'zustand';

export interface PumpData {
  timestamp: number;
  pressure?: number;
  flowRate?: number;
  temperature?: number;
  voltage?: number;
  current?: number;
  [key: string]: number | undefined;
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

export type TestView = 'none' | 'auto' | 'max_pressure' | 'max_flow';

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
  
  // Data
  dataHistory: PumpData[];
  latestData: PumpData | null;
  
  // Actions
  setConnectionStatus: (status: TestBenchState['connectionStatus']) => void;
  setPumpState: (state: TestBenchState['pumpState']) => void;
  setIsRunning: (running: boolean) => void;
  addDataPoint: (data: PumpData) => void;
  clearData: () => void;
  setSelectedPump: (pump: PumpType | null) => void;
  setCurrentTestView: (view: TestView) => void;
  setTargetFlow: (flow: number) => void;
  fetchAvailablePumps: () => Promise<void>;
  
  // Control actions (these will trigger API calls)
  startPump: () => Promise<void>;
  stopPump: () => Promise<void>;
  setWarningDisabled: () => Promise<void>;
  setWarningEnabled: () => Promise<void>;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

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
  dataHistory: [],
  latestData: null,
  
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
  
  addDataPoint: (data) => {
    const currentHistory = get().dataHistory;
    const newHistory = [...currentHistory, data].slice(-1000); // Keep last 1000 points
    set({ 
      dataHistory: newHistory,
      latestData: data
    });
  },
  
  clearData: () => set({ dataHistory: [], latestData: null }),
  
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
}));

