import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeSvgProps {
  value: string;
  size?: number;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({ value, size = 88 }) => {
  const [svgString, setSvgString] = useState<string>('');

  useEffect(() => {
    if (!value) return;
    QRCode.toString(
      value,
      {
        type: 'svg',
        width: size,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      },
      (err, str) => {
        if (!err && str) setSvgString(str);
      }
    );
  }, [value, size]);

  if (!svgString) return null;

  return (
    <div
      className="inline-block p-1.5 bg-white rounded border border-slate-300 shadow-xs"
      title={`QR Code for ${value}`}
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
};
