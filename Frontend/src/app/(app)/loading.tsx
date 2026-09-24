import { getTranslations } from 'next-intl/server';
import { LoadingMark } from '@/components/brand/iso-blocks';

export default async function Loading() {
  const t = await getTranslations('states');
  return <LoadingMark label={t('loadingPage')} />;
}
