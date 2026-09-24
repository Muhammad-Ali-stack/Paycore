import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '../../messages/en.json';
import enMerchant from '../../messages/en.merchant.json';
import enAdmin from '../../messages/en.admin.json';
import ur from '../../messages/ur.json';
import urMerchant from '../../messages/ur.merchant.json';
import urAdmin from '../../messages/ur.admin.json';

export const messages = {
  en: { ...en, ...enMerchant, ...enAdmin },
  ur: { ...ur, ...urMerchant, ...urAdmin },
};

export function Providers({ children, locale = 'en' }: { children: React.ReactNode; locale?: 'en' | 'ur' }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Karachi">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: React.ReactElement, opts: RenderOptions & { locale?: 'en' | 'ur' } = {}) {
  const { locale, ...rest } = opts;
  return render(ui, { wrapper: ({ children }) => <Providers locale={locale}>{children}</Providers>, ...rest });
}
