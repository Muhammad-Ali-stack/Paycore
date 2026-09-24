'use client';

import { useTranslations } from 'next-intl';
import { Badge, statusTone } from './badge';

/** Translated status pill for any backend status string. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useTranslations('status');
  const key = status as Parameters<typeof t>[0];
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {t.has(key) ? t(key) : status}
    </Badge>
  );
}
