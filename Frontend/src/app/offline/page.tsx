import { getTranslations } from 'next-intl/server';
import { IsoBlocks } from '@/components/brand/iso-blocks';

/** Served by the service worker when a navigation fails offline. */
export default async function OfflinePage() {
  const t = await getTranslations('states');
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <IsoBlocks count={3} className="h-24" />
      <p className="max-w-sm text-sm text-fg-muted">{t('offline')}</p>
    </main>
  );
}
