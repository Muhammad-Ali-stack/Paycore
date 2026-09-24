import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { IsoBlocks } from '@/components/brand/iso-blocks';
import { Button } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('states');
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <IsoBlocks count={2} className="h-20" />
      <h1 className="text-2xl font-semibold">{t('notFoundTitle')}</h1>
      <p className="max-w-sm text-sm text-fg-muted">{t('notFoundBody')}</p>
      <Button asChild>
        <Link href="/">{t('goHome')}</Link>
      </Button>
    </main>
  );
}
