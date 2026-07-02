/* eslint-disable */
import React, { useState, useRef, useEffect } from 'react';
import MainContent from './MainContent';
import RightPanel from './RightPanel';

const Home: React.FC = () => {
  const [rightWidth, setRightWidth] = useState(500);
  const isResizingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const newWidth = window.innerWidth - e.clientX;
    // Bound the width between 320px and 800px
    if (newWidth > 320 && newWidth < 800) {
      setRightWidth(newWidth);
    }
  };

  const handleMouseUp = () => {
    isResizingRef.current = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
    
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Clean up listeners if component unmounts during drag
  useEffect(() => {
    (window as any).__setRightWidth = setRightWidth;
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="flex flex-1 h-full overflow-hidden relative">
      <div className="flex-1 min-w-0 h-full">
        <MainContent />
      </div>
      
      <div 
        onMouseDown={handleMouseDown}
        className="w-1.5 hover:w-2 hover:bg-indigo-500/50 active:bg-indigo-600 transition-all cursor-col-resize shrink-0 h-full bg-slate-200 border-l border-r border-slate-300 z-20"
      />
      
      <div style={{ width: `${rightWidth}px` }} className="shrink-0 h-full">
        <RightPanel />
      </div>
    </div>
  );
};

export default Home;
