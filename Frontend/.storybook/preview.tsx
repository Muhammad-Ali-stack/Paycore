import * as React from 'react';
import type { Preview } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Direction } from 'radix-ui';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/noto-naskh-arabic';
import '../src/app/globals.css';
import en from '../messages/en.json';
import enMerchant from '../messages/en.merchant.json';
import enAdmin from '../messages/en.admin.json';
import ur from '../messages/ur.json';
import urMerchant from '../messages/ur.merchant.json';
import urAdmin from '../messages/ur.admin.json';
import { TooltipProvider } from '../src/components/ui/primitives';

const messages = {
  en: { ...en, ...enMerchant, ...enAdmin },
  ur: { ...ur, ...urMerchant, ...urAdmin },
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'PayCore theme',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['dark', 'light'], dynamicTitle: true },
    },
    locale: {
      description: 'Language (Urdu is RTL)',
      toolbar: { title: 'Locale', icon: 'globe', items: ['en', 'ur'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark', locale: 'en' },
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'error' },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === 'light' ? 'light' : 'dark';
      const locale = context.globals.locale === 'ur' ? 'ur' : 'en';
      const dir = locale === 'ur' ? 'rtl' : 'ltr';
      React.useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dir = dir;
        document.documentElement.lang = locale;
      }, [theme, dir, locale]);
      return (
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Karachi">
            <Direction.Provider dir={dir}>
              <TooltipProvider>
                <div className="min-h-[200px] bg-bg p-4 text-fg">
                  <Story />
                </div>
              </TooltipProvider>
            </Direction.Provider>
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
    },
  ],
};

export default preview;
