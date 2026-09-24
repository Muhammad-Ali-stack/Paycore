'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from './button';

export function CopyButton({
  value,
  label,
  ...props
}: { value: string; label?: string } & Omit<ButtonProps, 'onClick'>) {
  const t = useTranslations('common');
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      {...props}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? t('copied') : (label ?? t('copy'))}</span>
    </Button>
  );
}
