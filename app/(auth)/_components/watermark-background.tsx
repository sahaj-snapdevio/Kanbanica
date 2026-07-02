"use client";

import { useEffect, useState } from "react";
import { LOGO_PATH } from "@/config/platform";

export function WatermarkBackground() {
  const [logos, setLogos] = useState<{
    id: number;
    x: number;
    y: number;
    size: number;
    rotation: number;
    opacity: number;
    blur: number;
  }[]>([]);

  useEffect(() => {
    // Generate grid to prevent overlaps
    const generateLogos = () => {
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      
      // Calculate how many to place to get ~150 logos
      // Area per logo = (width * height) / 150
      // Cell size = sqrt(Area)
      const targetCount = 150;
      const cellArea = (width * height) / targetCount;
      const cellSize = Math.sqrt(cellArea);
      
      const cols = Math.ceil(width / cellSize);
      const rows = Math.ceil(height / cellSize);
      
      const generated = [];
      let id = 0;
      
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Center of the cell
          const cellX = (c + 0.5) * cellSize;
          const cellY = (r + 0.5) * cellSize;
          
          // Size between 20 and 40
          const size = 20 + Math.random() * 20;
          
          // We can jitter by quite a bit without overlapping, 
          // max jitter is (cellSize - size - gap) / 2
          const gap = 5;
          const maxJitter = Math.max(0, (cellSize - size - gap) / 2);
          
          const jX = (Math.random() * 2 - 1) * maxJitter;
          const jY = (Math.random() * 2 - 1) * maxJitter;
          
          const x = cellX + jX - size / 2;
          const y = cellY + jY - size / 2;
          
          const rotation = (Math.random() * 20) - 10; // -10 to +10
          const opacity = 0.04 + Math.random() * 0.04; // 0.04 to 0.08
          
          // Some have subtle blur 1-2px, some none
          const blur = Math.random() > 0.5 ? Math.random() * 1 + 1 : 0;
          
          generated.push({ id: id++, x, y, size, rotation, opacity, blur });
        }
      }
      
      setLogos(generated);
    };

    generateLogos();
    
    // Recalculate on resize
    const handleResize = () => {
      generateLogos();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (logos.length === 0) return null;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {logos.map((logo) => (
        <div
          key={logo.id}
          className="absolute"
          style={{
            left: `${logo.x}px`,
            top: `${logo.y}px`,
            width: `${logo.size}px`,
            height: `${logo.size}px`,
            opacity: logo.opacity,
            transform: `rotate(${logo.rotation}deg)`,
            filter: logo.blur > 0 ? `blur(${logo.blur}px)` : 'none',
          }}
        >
          <img
            src={LOGO_PATH}
            alt=""
            className="w-full h-full object-contain"
            aria-hidden="true"
          />
        </div>
      ))}
    </div>
  );
}