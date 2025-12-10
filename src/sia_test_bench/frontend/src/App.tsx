import { SplitPane } from './components/SplitPane';
import { Header } from './components/Header';
import { ControlPlane } from './components/ControlPlane';
import { VisualizationPlane } from './components/VisualizationPlane';
import { useWebSocket } from './hooks/useWebSocket';
import './App.css';

function App() {
  // Initialize WebSocket connection
  useWebSocket();

  return (
    <div className="app-container">
      <Header />
      <SplitPane
        left={<ControlPlane />}
        right={<VisualizationPlane />}
      />
    </div>
  );
}

export default App;
