import React from 'react';

interface BarcodeSvgProps {
  value: string;
  width?: number;
  height?: number;
  showText?: boolean;
}

/**
 * Clean SVG Barcode Renderer
 * Renders real high-contrast vertical bars for visual display and thermal printing.
 */
export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  width = 180,
  height = 42,
  showText = true
}) => {
  // Generate deterministic bar widths based on character char codes
  const bars: { x: number; w: number }[] = [];
  let currentX = 10;

  // Start guard bars
  bars.push({ x: currentX, w: 2 }); currentX += 4;
  bars.push({ x: currentX, w: 2 }); currentX += 4;

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const pattern = [(code % 3) + 1, ((code >> 1) % 2) + 1, ((code >> 2) % 3) + 1];
    for (const w of pattern) {
      bars.push({ x: currentX, w });
      currentX += w + 2;
    }
  }

  // Stop guard bars
  bars.push({ x: currentX, w: 2 }); currentX += 4;
  bars.push({ x: currentX, w: 2 }); currentX += 6;

  const totalWidth = currentX + 10;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${totalWidth} ${height}`}
        style={{ display: 'block' }}
      >
        <rect width={totalWidth} height={height} fill="#FFFFFF" />
        {bars.map((bar, idx) => (
          <rect
            key={idx}
            x={bar.x}
            y={2}
            width={bar.w}
            height={height - (showText ? 14 : 4)}
            fill="#000000"
          />
        ))}
      </svg>
      {showText && (
        <span style={{
          fontFamily: 'monospace',
          fontSize: '11px',
          fontWeight: 700,
          color: '#000000',
          letterSpacing: '2px',
          marginTop: '2px'
        }}>
          {value}
        </span>
      )}
    </div>
  );
};
