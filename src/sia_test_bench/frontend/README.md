# SIA Test Bench Frontend

React + Vite frontend for the SIA Test Bench application.

## Tech Stack

- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Zustand** - State management
- **Recharts** - Data visualization

## Project Structure

```
src/
├── components/
│   ├── ControlPlane.tsx      # Left side - Control interface
│   ├── VisualizationPlane.tsx # Right side - Data visualization
│   └── SplitPane.tsx         # Split layout component
├── hooks/
│   └── useWebSocket.ts       # WebSocket connection hook
├── store/
│   └── useTestBenchStore.ts  # Zustand store for state management
├── App.tsx                   # Main app component
└── main.tsx                  # Entry point
```

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (or the next available port).

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Environment Variables

Create a `.env` file in the frontend directory:

```env
VITE_WS_URL=ws://localhost:8080/ws
VITE_API_URL=http://localhost:8080/api
```

## Features

### Control Plane (Left Side)
- Connection status indicator
- Pump control (Start/Stop)
- Warning system controls
- Data management

### Visualization Plane (Right Side)
- Real-time data charts
- Current value displays
- Multiple metric visualizations:
  - Pressure & Flow Rate
  - Temperature
  - Voltage & Current

## WebSocket Integration

The frontend connects to the backend via WebSocket for real-time data streaming. The connection:
- Automatically reconnects on disconnect
- Handles connection errors gracefully
- Updates UI based on connection status

## State Management

Zustand is used for global state management. The store (`useTestBenchStore`) manages:
- Connection status
- Pump state
- Data history
- Control actions

## Next Steps

1. **Backend Integration**: Implement WebSocket server in the Python backend
2. **API Endpoints**: Add REST endpoints for pump control actions
3. **Data Format**: Define the exact data structure for pump metrics
4. **Error Handling**: Enhance error handling and user feedback
5. **Styling**: Customize colors and styling to match brand guidelines
