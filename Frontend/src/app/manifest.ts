import type { MetadataRoute } from 'next';
import { chrome } from '@/design/tokens';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PayCore',
    short_name: 'PayCore',
    description: 'Multi-currency wallet for PKR, AED and USD',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: chrome.dark,
    theme_color: chrome.dark,
    categories: ['finance'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      { name: 'Send money', url: '/send' },
      { name: 'Scan & pay', url: '/scan' },
    ],
  };
}
