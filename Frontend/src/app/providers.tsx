'use client';

import * as React from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Direction } from 'radix-ui';
import { useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/primitives';
import { onSessionExpired } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { useUiStore } from '@/stores/ui';

function makeClient() {
  const onError = (e: unknown) => {
    // No PII: log code + correlation id only.
    if (isApiError(e) && process.env.NODE_ENV !== 'production') {
      console.debug('[api]', e.code, e.status, e.correlationId);
    }
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (count, e) => {
          if (isApiError(e) && e.status >= 400 && e.status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children, dir }: { children: React.ReactNode; dir: 'ltr' | 'rtl' }) {
  const [client] = React.useState(makeClient);
  const router = useRouter();
  const theme = useUiStore((s) => s.theme);

  React.useEffect(() => {
    void useUiStore.persist.rehydrate();
  }, []);

  React.useEffect(
    () =>
      onSessionExpired(() => {
        client.clear();
        const next = encodeURIComponent(window.location.pathname);
        router.replace(`/login?expired=1&next=${next}`);
      }),
    [client, router],
  );

  React.useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={client}>
      <Direction.Provider dir={dir}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster
            theme={theme}
            position="top-center"
            dir={dir}
            toastOptions={{
              classNames: {
                toast: '!bg-raised !border-border !text-fg !rounded-lg !shadow-card',
                description: '!text-fg-muted',
                success: '[&_[data-icon]]:!text-success',
                error: '[&_[data-icon]]:!text-danger',
              },
            }}
          />
        </TooltipProvider>
      </Direction.Provider>
    </QueryClientProvider>
  );
}
