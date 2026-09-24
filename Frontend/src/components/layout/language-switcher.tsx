'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import { LOCALE_COOKIE, type Locale } from '@/i18n/config';
import { Button } from '@/components/ui/button';

export function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/** Toggles English / Urdu. Direction flips via <html dir> on the server render. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('profile');
  const router = useRouter();
  const [pending, start] = useTransition();
  const next: Locale = locale === 'ur' ? 'en' : 'ur';
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={pending}
      lang={next}
      onClick={() => {
        setLocaleCookie(next);
        start(() => router.refresh());
      }}
      aria-label={t('language')}
      data-testid="language-switcher"
    >
      <Languages aria-hidden />
      {next === 'ur' ? 'اردو' : 'English'}
    </Button>
  );
}
