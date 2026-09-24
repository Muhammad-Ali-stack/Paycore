'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { BookUser, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/primitives';
import { InlineError } from '@/components/states/states';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecentContacts } from '@/lib/api/hooks';
import { users } from '@/lib/api/services';
import type { UserLookup } from '@/lib/api/contracts/phase2';
import { isApiError } from '@/lib/api/errors';

type ContactsManager = {
  select: (props: string[], opts?: { multiple?: boolean }) => Promise<{ tel?: string[] }[]>;
};

/** Search by phone / @username, recent contacts, and the device Contact Picker where supported. */
export type RecipientRef = { phone?: string; username?: string };

const noopSubscribe = () => () => undefined;

export function RecipientPicker({
  onPick,
  initialQuery,
}: {
  onPick: (u: UserLookup, ref: RecipientRef) => void;
  initialQuery?: string;
}) {
  const t = useTranslations('send');
  const [q, setQ] = React.useState(initialQuery ?? '');
  const contacts = useRecentContacts();
  const lookup = useMutation({
    mutationFn: async (query: string) => ({ user: await users.lookup(query), query }),
    // The lookup only returns a masked phone, so keep what the user typed as the reference.
    onSuccess: ({ user, query }) =>
      onPick(user, query.startsWith('+') ? { phone: query } : { username: user.username ?? query.replace(/^@/, '') }),
  });
  // Contact Picker API (Android Chrome); false during SSR.
  const hasPicker = React.useSyncExternalStore(
    noopSubscribe,
    () => 'contacts' in navigator,
    () => false,
  );

  const { mutate } = lookup;
  React.useEffect(() => {
    if (initialQuery) mutate(initialQuery);
  }, [initialQuery, mutate]);

  const normalize = (v: string) => {
    const s = v.trim().replace(/[\s-]/g, '');
    if (s.startsWith('+')) return s;
    if (/^0\d{10}$/.test(s)) return `+92${s.slice(1)}`; // local PK format
    return s.startsWith('@') ? s : `@${s}`;
  };

  const notFound = isApiError(lookup.error) && lookup.error.code === 'NOT_FOUND';

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) lookup.mutate(normalize(q));
        }}
      >
        <Field label={t('searchLabel')} error={notFound ? t('notFound') : undefined}>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            dir="ltr"
            data-testid="recipient-search"
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" loading={lookup.isPending} disabled={!q.trim()} data-testid="recipient-find">
            <Search aria-hidden /> {t('find')}
          </Button>
          {hasPicker ? (
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  const mgr = (navigator as Navigator & { contacts: ContactsManager }).contacts;
                  const [c] = await mgr.select(['tel'], { multiple: false });
                  const tel = c?.tel?.[0];
                  if (tel) {
                    setQ(tel);
                    lookup.mutate(normalize(tel));
                  }
                } catch {
                  /* cancelled */
                }
              }}
            >
              <BookUser aria-hidden /> {t('pickContact')}
            </Button>
          ) : null}
        </div>
        {lookup.error && !notFound ? <InlineError error={lookup.error} /> : null}
      </form>

      <section aria-labelledby="recent-contacts">
        <h2 id="recent-contacts" className="mb-2 text-sm font-semibold">
          {t('recent')}
        </h2>
        {contacts.isPending ? (
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-20 rounded-lg" />
            ))}
          </div>
        ) : contacts.data?.length ? (
          <ul className="-mx-1 flex scrollbar-none gap-2 overflow-x-auto px-1 pb-1">
            {contacts.data
              .filter((c) => c.username)
              .map((c) => (
                <li key={c.userId}>
                  <button
                    type="button"
                    onClick={() => lookup.mutate(`@${c.username}`)}
                    className="flex w-20 flex-col items-center gap-1.5 rounded-lg p-2 text-center hover:bg-raised"
                  >
                    <Avatar name={c.displayName} />
                    <span className="w-full truncate text-xs">{c.displayName}</span>
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
