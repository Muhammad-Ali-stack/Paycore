'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/states/states';

/** Route-level error boundary: contract-shaped message + retry. No PII is logged. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[route-error]', error.digest ?? error.name);
  }, [error]);
  return (
    <main id="main" className="mx-auto max-w-lg p-6">
      <ErrorState error={error} onRetry={reset} />
    </main>
  );
}
