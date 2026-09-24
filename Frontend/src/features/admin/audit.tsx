'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { CopyButton } from '@/components/ui/copy-button';
import type { AuditEvent } from '@/lib/api/contracts/future';
import { cn, shortId } from '@/lib/utils';
import { JsonBlock, Td, Th, useDateTime } from './shared';

function Changes({ event }: { event: AuditEvent }) {
  const t = useTranslations('admin');
  if (!event.changes) return <p className="text-sm text-fg-muted">{t('audit.noChanges')}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">{t('audit.before')}</p>
        <JsonBlock value={event.changes.before} />
      </div>
      <div className="grid gap-1.5">
        <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">{t('audit.after')}</p>
        <JsonBlock value={event.changes.after} />
      </div>
    </div>
  );
}

function ToggleButton({
  open,
  onClick,
  controls,
  label,
}: {
  open: boolean;
  onClick: () => void;
  controls: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
    >
      <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
    </button>
  );
}

/**
 * Audit events as a table (md+) or stacked cards (mobile). Rows expand to show
 * the before/after change set. `compact` hides IP and correlation columns.
 */
export function AuditTable({ events, compact }: { events: AuditEvent[]; compact?: boolean }) {
  const t = useTranslations('admin');
  const dt = useDateTime();
  const [openIds, setOpenIds] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpenIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const cols = compact ? 6 : 8;

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <caption className="sr-only">{t('auditTitle')}</caption>
          <thead className="border-b border-border">
            <tr>
              <Th className="w-10">
                <span className="sr-only">{t('changes')}</span>
              </Th>
              <Th>{t('audit.time')}</Th>
              <Th>{t('actor')}</Th>
              <Th>{t('action')}</Th>
              <Th>{t('audit.target')}</Th>
              <Th>{t('outcome')}</Th>
              {compact ? null : <Th>{t('ip')}</Th>}
              {compact ? null : <Th>{t('audit.correlation')}</Th>}
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const open = openIds.has(e.id);
              const detailId = `audit-${e.id}`;
              return (
                <React.Fragment key={e.id}>
                  <tr className="border-b border-border/60 hover:bg-raised/50">
                    <Td className="py-2">
                      <ToggleButton
                        open={open}
                        onClick={() => toggle(e.id)}
                        controls={detailId}
                        label={t('audit.toggleChanges')}
                      />
                    </Td>
                    <Td className="whitespace-nowrap text-fg-muted">{dt(e.at)}</Td>
                    <Td>
                      <span className="block">{e.actor.displayName}</span>
                      <span className="block text-xs text-fg-muted">{e.actor.role}</span>
                    </Td>
                    <Td>
                      <span className="code text-xs">{e.action}</span>
                    </Td>
                    <Td>
                      <span className="block text-xs text-fg-muted">{e.targetType}</span>
                      <span className="code text-xs" title={e.targetId}>
                        {shortId(e.targetId)}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={e.outcome} />
                    </Td>
                    {compact ? null : <Td className="code text-xs text-fg-muted">{e.ipAddress ?? '–'}</Td>}
                    {compact ? null : <Td className="code text-xs text-fg-muted">{e.correlationId}</Td>}
                  </tr>
                  {open ? (
                    <tr id={detailId} className="border-b border-border/60 bg-raised/40">
                      <td colSpan={cols} className="px-3 py-3">
                        <Changes event={e} />
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                          <span className="code">{e.targetId}</span>
                          <CopyButton value={e.targetId} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-2 md:hidden">
        {events.map((e) => {
          const open = openIds.has(e.id);
          const detailId = `audit-m-${e.id}`;
          return (
            <li key={e.id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="code truncate text-xs text-fg">{e.action}</p>
                  <p className="truncate text-sm text-fg">{e.actor.displayName}</p>
                  <p className="text-xs text-fg-muted">{dt(e.at)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge status={e.outcome} />
                  <ToggleButton
                    open={open}
                    onClick={() => toggle(e.id)}
                    controls={detailId}
                    label={t('audit.toggleChanges')}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                {e.targetType} · <span className="code">{shortId(e.targetId)}</span>
                {compact ? null : (
                  <>
                    {' · '}
                    <span className="code">{e.ipAddress ?? '–'}</span>
                    {' · '}
                    <span className="code">{e.correlationId}</span>
                  </>
                )}
              </p>
              {open ? (
                <div id={detailId} className="mt-3">
                  <Changes event={e} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function AuditSkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="skeleton h-12 rounded-md" />
      ))}
    </div>
  );
}
