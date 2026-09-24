import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/noto-naskh-arabic';
import './globals.css';
import { dirOf, isLocale } from '@/i18n/config';
import { chrome } from '@/design/tokens';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'PayCore', template: '%s · PayCore' },
  description: 'Multi-currency digital wallet for PKR, AED and USD.',
  applicationName: 'PayCore',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/logo.svg', type: 'image/svg+xml' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'PayCore', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: chrome.dark },
    { media: '(prefers-color-scheme: light)', color: chrome.light },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const store = await cookies();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const theme = store.get('pc_theme')?.value === 'light' ? 'light' : 'dark';
  const safeLocale = isLocale(locale) ? locale : 'en';
  const dir = dirOf(safeLocale);

  return (
    <html lang={safeLocale} dir={dir} data-theme={theme} suppressHydrationWarning>
      <body nonce={nonce}>
        <a
          href="#main"
          className="sr-only z-[100] rounded-md bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
        >
          {(messages as { common: { skipToContent: string } }).common.skipToContent}
        </a>
        <NextIntlClientProvider locale={safeLocale} messages={messages}>
          <Providers dir={dir}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
