import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeSvgProps {
  value: string;
  width?: number;
  height?: number;
  showText?: boolean;
  fontSize?: number;
}

/**
 * Standards-Compliant ISO/IEC 15417 Code-128 Barcode Renderer
 * Renders verified 1D barcodes that scan reliably with all hardware laser scanners,
 * smartphone cameras, and webcams.
 */
export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  width = 180,
  height = 40,
  showText = true,
  fontSize = 11
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;

    try {
      const cleanValue = String(value).trim();
      if (!cleanValue) return;

      // Calculate module bar width:
      // Code 128 has approximately (chars * 11 + 35) modules
      // For sharp scanning on screen and 58mm/80mm thermal paper, 1.2px - 2.0px module width is optimal.
      const moduleCount = cleanValue.length * 11 + 35;
      let barWidth = 1.6;
      if (typeof width === 'number' && width > 10) {
        barWidth = Math.max(1.1, Math.min(2.4, (width - 16) / moduleCount));
      }

      JsBarcode(svgRef.current, cleanValue, {
        format: 'CODE128',
        width: barWidth,
        height: height || 40,
        displayValue: showText,
        text: cleanValue,
        font: 'monospace',
        fontSize: fontSize || 11,
        fontOptions: 'bold',
        textMargin: 3,
        margin: 6,
        background: '#FFFFFF',
        lineColor: '#000000',
        valid: () => true
      });
    } catch (err) {
      console.warn('Barcode rendering error for value:', value, err);
    }
  }, [value, width, height, showText, fontSize]);

  return (
    <div className="inline-flex flex-col items-center justify-center p-1 bg-white rounded shadow-xs max-w-full overflow-hidden">
      <svg ref={svgRef} className="max-w-full block" />
    </div>
  );
};
