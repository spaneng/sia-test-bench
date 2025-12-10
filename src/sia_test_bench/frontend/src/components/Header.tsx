import { useEffect, useState } from 'react';
import { useTestBenchStore } from '../store/useTestBenchStore';
import './Header.css';

export function Header() {
  const { connectionStatus } = useTestBenchStore();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

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

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="app-header">
      <div className="header-left">
        <h1>SIA Test Bench</h1>
      </div>
      <div className="header-right">
        <div className="header-status">
          <span
            className="status-dot"
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className="status-text">{connectionStatus.toUpperCase()}</span>
        </div>
        <div className="header-time">
          {formatTime(currentTime)}
        </div>
      </div>
    </div>
  );
}

