import type { ReactNode } from 'react';
import './SplitPane.css';

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
}

export function SplitPane({ left, right }: SplitPaneProps) {
  return (
    <div className="split-pane-container">
      <div className="split-pane-left">
        {left}
      </div>
      <div className="split-pane-divider" />
      <div className="split-pane-right">
        {right}
      </div>
    </div>
  );
}

