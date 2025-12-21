import { useRef, useEffect, useState, type ReactNode } from 'react';

interface CollapseProps {
  in: boolean;
  timeout?: number;
  children: ReactNode;
}

export function Collapse({ in: isOpen, timeout = 300, children }: CollapseProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>(isOpen ? 'auto' : 0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!contentRef.current) return;

    if (isOpen) {
      // Expanding: measure content height and animate to it
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      setIsAnimating(true);

      // After animation, set to auto to allow dynamic content
      const timer = setTimeout(() => {
        setHeight('auto');
        setIsAnimating(false);
      }, timeout);

      return () => clearTimeout(timer);
    } else {
      // Collapsing: first set explicit height, then animate to 0
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      setIsAnimating(true);

      // Use requestAnimationFrame to ensure the height is set before animating
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHeight(0);
        });
      });

      const timer = setTimeout(() => {
        setIsAnimating(false);
      }, timeout);

      return () => clearTimeout(timer);
    }
  }, [isOpen, timeout]);

  return (
    <div
      ref={contentRef}
      style={{
        height: height === 'auto' ? 'auto' : `${height}px`,
        overflow: isAnimating ? 'hidden' : (isOpen ? 'visible' : 'hidden'),
        transition: isAnimating ? `height ${timeout}ms ease-in-out` : 'none',
        opacity: isOpen || isAnimating ? 1 : 0,
      }}
    >
      {children}
    </div>
  );
}

