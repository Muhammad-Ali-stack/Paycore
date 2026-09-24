'use client';

import { useEffect, useState } from 'react';

/** Seconds remaining until an ISO timestamp (0 when passed or null). Ticks every second. */
export function useCountdown(expiresAt: string | null | undefined): number {
  const target = expiresAt ? Date.parse(expiresAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const tick = () => setNow(Date.now());
    // Re-sync immediately when the target changes (e.g. a fresh quote), then every second.
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(() => {
      tick();
      if (Date.now() >= target) window.clearInterval(id);
    }, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [target]);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}
