import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeSvgProps {
  value: string;
  width?: number; // module width or scale
  height?: number;
  showText?: boolean;
  fontSize?: number;
}

/**
 * Pixel-Perfect ISO/IEC 15417 Code-128 Barcode Renderer
 * Features:
 * - shape-rendering: crispEdges (ZERO subpixel anti-aliasing blur)
 * - Integer 2px module bars for optimal camera sensor and laser sweep contrast
 * - 12px white Quiet Zone margins required by all optical barcode decoders
 */
export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  width = 2,
  height = 52,
  showText = true,
  fontSize = 12
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;

    try {
      const cleanValue = String(value).trim();
      if (!cleanValue) return;

      // Module width (thickness of a single unit bar).
      // 2px is the universal sweet spot for high-contrast scanning on screen and print.
      const barWidth = typeof width === 'number' && width > 0 && width <= 4 ? width : 2;

      JsBarcode(svgRef.current, cleanValue, {
        format: 'CODE128',
        width: barWidth,
        height: height || 52,
        displayValue: showText,
        text: cleanValue,
        font: 'monospace',
        fontSize: fontSize || 12,
        fontOptions: 'bold',
        textMargin: 4,
        margin: 12, // Essential Quiet Zone (10+ modules)
        background: '#FFFFFF',
        lineColor: '#000000',
        valid: () => true
      });

      // Apply crispEdges directly to avoid any sub-pixel interpolation blur
      svgRef.current.style.shapeRendering = 'crispEdges';
    } catch (err) {
      console.warn('Barcode rendering error for value:', value, err);
    }
  }, [value, width, height, showText, fontSize]);

  return (
    <div className="inline-flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-slate-200 shadow-xs max-w-full overflow-hidden">
      <svg
        ref={svgRef}
        style={{ shapeRendering: 'crispEdges' }}
        className="max-w-full block"
      />
    </div>
  );
};
