'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Share2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useErrorMessage } from '@/components/states/states';

/**
 * Success / failure receipt with share. `shareText` must not contain PII beyond
 * what the user chooses to share (display name, amount, reference).
 */
export function Receipt({
  status,
  title,
  subtitle,
  amount,
  children,
  shareText,
  actions,
  error,
}: {
  status: 'success' | 'failure';
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  amount?: React.ReactNode;
  children?: React.ReactNode;
  shareText?: string;
  actions?: React.ReactNode;
  error?: unknown;
}) {
  const t = useTranslations('common');
  const reduce = useReducedMotion();
  const errorText = useErrorMessage()(error);
  const [shared, setShared] = React.useState(false);
  const share = async () => {
    if (!shareText) return;
    try {
      if (navigator.share) await navigator.share({ title: 'PayCore', text: shareText });
      else {
        await navigator.clipboard.writeText(shareText);
        setShared(true);
      }
    } catch {
      /* user cancelled */
    }
  };
  return (
    <Card className="mx-auto w-full max-w-md overflow-hidden" data-testid={`receipt-${status}`}>
      <div className="balance-surface flex flex-col items-center gap-3 border-b border-border px-6 py-8 text-center">
        <motion.div
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        >
          {status === 'success' ? (
            <CheckCircle2 className="size-12 text-success" aria-hidden />
          ) : (
            <XCircle className="size-12 text-danger" aria-hidden />
          )}
        </motion.div>
        <h2 className="text-lg font-semibold" role="status">
          {title}
        </h2>
        {amount ? <div>{amount}</div> : null}
        {subtitle ? <p className="text-sm text-fg-muted">{subtitle}</p> : null}
        {status === 'failure' && error ? <p className="text-sm text-danger">{errorText}</p> : null}
      </div>
      {children ? <div className="p-6">{children}</div> : null}
      <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
        {shareText ? (
          <Button variant="secondary" onClick={() => void share()}>
            <Share2 aria-hidden /> {shared ? t('copied') : t('share')}
          </Button>
        ) : null}
        {actions}
      </div>
    </Card>
  );
}
