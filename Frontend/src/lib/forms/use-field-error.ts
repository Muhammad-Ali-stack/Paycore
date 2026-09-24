'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { FieldError } from 'react-hook-form';

type ValidationKey = Parameters<ReturnType<typeof useTranslations<'validation'>>>[0];

/** Turns a Zod/RHF error (message = validation.* key) into translated text. */
export function useFieldError() {
  const t = useTranslations('validation');
  return useCallback(
    (err?: FieldError | { message?: string }) => {
      if (!err?.message) return undefined;
      const key = err.message as ValidationKey;
      return t.has(key) ? t(key) : t('required');
    },
    [t],
  );
}
