'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/app-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { MerchantGate } from '@/features/merchant/merchant-gate';
import { ApiKeysPanel } from '@/features/merchant/api-keys-panel';
import { WebhooksPanel } from '@/features/merchant/webhooks-panel';

export default function MerchantDevelopersPage() {
  const t = useTranslations('merchant');
  return (
    <MerchantGate>
      {() => (
        <>
          <PageHeader title={t('developersTitle')} description={t('developersDescription')} />
          <Tabs defaultValue="keys" className="grid gap-4">
            <TabsList className="justify-self-start">
              <TabsTrigger value="keys">{t('apiKeys')}</TabsTrigger>
              <TabsTrigger value="webhooks">{t('webhooks')}</TabsTrigger>
            </TabsList>
            <TabsContent value="keys">
              <ApiKeysPanel />
            </TabsContent>
            <TabsContent value="webhooks">
              <WebhooksPanel />
            </TabsContent>
          </Tabs>
        </>
      )}
    </MerchantGate>
  );
}
