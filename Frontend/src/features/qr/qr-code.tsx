'use client';

import * as React from 'react';
import QRCode from 'qrcode';
import { LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

/**
 * Renders an opaque PayCore QR payload as crisp SVG modules (no canvas, no data
 * URL, CSP-friendly). Always dark-on-light for scanners, with the logo mark in
 * the centre (error correction H tolerates the overlay).
 */
export function QrCode({
  payload,
  size = 240,
  className,
  label,
  withLogo = true,
}: {
  payload: string;
  size?: number;
  className?: string;
  label: string;
  withLogo?: boolean;
}) {
  const { cells, count } = React.useMemo(() => {
    const qr = QRCode.create(payload, { errorCorrectionLevel: withLogo ? 'H' : 'M' });
    const n = qr.modules.size;
    const out: { x: number; y: number }[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) out.push({ x, y });
    return { cells: out, count: n };
  }, [payload, withLogo]);
  const quiet = 3;
  const dim = count + quiet * 2;
  const logoSpan = Math.round(count * 0.22);
  const logoStart = quiet + (count - logoSpan) / 2;
  return (
    <div
      className={cn('relative inline-block rounded-lg p-3', className)}
      style={{ background: 'var(--pc-qr-bg)', width: size, height: size }}
      data-qr-payload={payload}
    >
      <svg
        viewBox={`0 0 ${dim} ${dim}`}
        role="img"
        aria-label={label}
        className="size-full"
        shapeRendering="crispEdges"
      >
        <path
          fill="var(--pc-qr-fg)"
          d={cells
            .filter(
              (c) =>
                !withLogo ||
                !(
                  c.x + quiet >= logoStart - 0.5 &&
                  c.x + quiet < logoStart + logoSpan + 0.5 &&
                  c.y + quiet >= logoStart - 0.5 &&
                  c.y + quiet < logoStart + logoSpan + 0.5
                ),
            )
            .map((c) => `M${c.x + quiet} ${c.y + quiet}h1v1h-1z`)
            .join('')}
        />
      </svg>
      {withLogo ? (
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md"
          style={{ background: 'var(--pc-qr-bg)', width: size * 0.2, height: size * 0.2 }}
        >
          <LogoMark title={null} className="size-full p-1" />
        </span>
      ) : null}
    </div>
  );
}
