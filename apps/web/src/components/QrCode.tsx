import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * A QR code, drawn as an SVG.
 *
 * Always black on white with a quiet zone around it, whatever the theme:
 * scanners need the contrast and a dark-mode QR code is one that does not scan.
 * Drawn from the module matrix instead of injecting the library's markup, so
 * nothing here ever becomes HTML.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
    return { size: count + quiet * 2, path: d };
  }, [value]);

  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
