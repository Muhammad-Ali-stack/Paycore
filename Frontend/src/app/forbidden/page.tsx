import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { IsoBlocks } from '@/components/brand/iso-blocks';
import { Button } from '@/components/ui/button';

export default async function ForbiddenPage() {
  const t = await getTranslations('states');
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <IsoBlocks count={3} className="h-24" />
      <h1 className="text-2xl font-semibold">{t('forbiddenTitle')}</h1>
      <p className="max-w-sm text-sm text-fg-muted">{t('forbiddenBody')}</p>
      <Button asChild>
        <Link href="/">{t('goHome')}</Link>
      </Button>
    </main>
  );
}
