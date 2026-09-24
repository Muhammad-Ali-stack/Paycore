'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ChevronRight, KeyRound, Laptop, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { setLocaleCookie } from '@/components/layout/language-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Checkbox, Segmented, Select, Switch } from '@/components/ui/primitives';
import { ListSkeleton, Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CodeInput } from '@/components/ui/code-input';
import { InlineError, QueryState } from '@/components/states/states';
import { AUTO_LOCK_MINUTES } from '@/components/layout/auto-lock';
import { qk, useKyc, useMe, useNotificationPrefs, usePrefs, useQueryClient, useSessions } from '@/lib/api/hooks';
import { auth, users } from '@/lib/api/services';
import type { NotificationEvent, NotificationPreferences } from '@/lib/api/contracts/future';
import { changePinSchema, profileSchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { useUiStore } from '@/stores/ui';
import { maskMiddle } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Currency } from '@/lib/api/contracts/common';

export default function ProfilePage() {
  const t = useTranslations();
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title={t('profile.title')} />
      <AccountCard />
      <VerificationLink />
      <SecurityCard />
      <SessionsCard />
      <NotificationsCard />
      <PreferencesCard />
    </div>
  );
}

function AccountCard() {
  const t = useTranslations();
  const fe = useFieldError();
  const format = useFormatter();
  const qc = useQueryClient();
  const me = useMe();
  const form = useForm<{ fullName: string; username: string }>({
    resolver: zodResolver(profileSchema),
    values: { fullName: me.data?.fullName ?? '', username: me.data?.username ?? '' },
  });
  const save = useMutation({
    mutationFn: (v: { fullName: string; username: string }) =>
      users.update({ fullName: v.fullName, username: v.username || undefined }),
    onSuccess: (u) => {
      qc.setQueryData(qk.me, u);
      toast.success(t('profile.profileSaved'));
    },
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('profile.account')}</CardTitle>
          {me.data ? (
            <CardDescription>
              {t('profile.memberSince', {
                date: format.dateTime(new Date(me.data.createdAt), { dateStyle: 'medium' }),
              })}
            </CardDescription>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <QueryState query={me} skeleton={<Skeleton className="h-40" />}>
          {(u) => (
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
              <Field label={t('profile.fullName')} error={fe(form.formState.errors.fullName)}>
                <Input autoComplete="name" {...form.register('fullName')} />
              </Field>
              <Field
                label={t('profile.username')}
                hint={t('profile.usernameHint')}
                error={fe(form.formState.errors.username)}
              >
                <Input dir="ltr" autoComplete="username" {...form.register('username')} />
              </Field>
              <div className="grid gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium">{t('profile.phone')}</span>
                <p className="code text-sm text-fg-muted">{maskMiddle(u.phone, 6, 3)}</p>
              </div>
              {save.error ? <InlineError error={save.error} className="sm:col-span-2" /> : null}
              <div className="sm:col-span-2">
                <Button type="submit" variant="secondary" loading={save.isPending} disabled={!form.formState.isDirty}>
                  {t('common.save')}
                </Button>
              </div>
            </form>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function VerificationLink() {
  const t = useTranslations();
  const kyc = useKyc();
  return (
    <Link
      href="/profile/kyc"
      className="flex items-center gap-4 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent/40"
    >
      <ShieldCheck className="size-6 text-accent" aria-hidden />
      <div className="flex-1">
        <p className="text-sm font-semibold">{t('profile.verification')}</p>
        <p className="text-xs text-fg-muted">{kyc.data ? t(`kyc.tiers.${kyc.data.tier}`) : t('common.loading')}</p>
      </div>
      <ChevronRight className="size-4 text-fg-muted rtl:rotate-180" aria-hidden />
    </Link>
  );
}

function SecurityCard() {
  const t = useTranslations();
  const me = useMe();
  const [open, setOpen] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.security')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <span className="flex items-center gap-3 text-sm">
            <KeyRound className="size-4 text-fg-muted" aria-hidden /> {t('pin.label')}
            {me.data && !me.data.pinSet ? <Badge tone="warning">{t('profile.pinNotSet')}</Badge> : null}
          </span>
          {me.data?.pinSet ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              {t('profile.changePin')}
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/setup-pin">{t('profile.setPin')}</Link>
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
          <span>
            {t('profile.autoLock')}
            <span className="block text-xs text-fg-muted">
              {t('profile.autoLockHint', { minutes: AUTO_LOCK_MINUTES })}
            </span>
          </span>
          <Badge tone="success">{t('common.on')}</Badge>
        </div>
        <ChangePinDialog open={open} onOpenChange={setOpen} />
      </CardContent>
    </Card>
  );
}

function ChangePinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const fe = useFieldError();
  const [values, setValues] = React.useState({ currentPin: '', newPin: '', confirmPin: '' });
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});
  const change = useMutation({
    mutationFn: () => auth.changePin({ currentPin: values.currentPin, newPin: values.newPin }),
    onSuccess: () => {
      toast.success(t('profile.pinChanged'));
      setValues({ currentPin: '', newPin: '', confirmPin: '' });
      onOpenChange(false);
    },
  });
  const submit = () => {
    const r = changePinSchema.safeParse(values);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), fe({ message: i.message })])));
      return;
    }
    setErrors({});
    change.mutate();
  };
  const field = (key: keyof typeof values, label: string) => (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium" id={`${key}-l`}>
        {label}
      </span>
      <CodeInput
        length={6}
        minLength={4}
        mask
        value={values[key]}
        onChange={(v) => setValues((s) => ({ ...s, [key]: v }))}
        aria-label={label}
        aria-invalid={errors[key] ? true : undefined}
      />
      {errors[key] ? (
        <p role="alert" className="text-xs text-danger">
          {errors[key]}
        </p>
      ) : null}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('profile.changePin')}</DialogTitle>
          <DialogDescription>{t('auth.pinSubtitle')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {field('currentPin', t('profile.currentPin'))}
          {field('newPin', t('profile.newPin'))}
          {field('confirmPin', t('auth.pinConfirm'))}
          {change.error ? <InlineError error={change.error} /> : null}
          <DialogFooter>
            <Button type="submit" loading={change.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SessionsCard() {
  const t = useTranslations();
  const format = useFormatter();
  const qc = useQueryClient();
  const q = useSessions();
  const revoke = useMutation({
    mutationFn: (id: string) => auth.revokeSession(id),
    onSuccess: () => {
      toast.success(t('profile.signedOutDevice'));
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.sessions')}</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState query={q} skeleton={<ListSkeleton rows={2} label={t('states.loadingList')} />}>
          {(sessions) => (
            <ul className="divide-y divide-border/60">
              {sessions.map((s) => {
                const mobile = /iPhone|Android/i.test(s.userAgent ?? s.deviceName ?? '');
                const Icon = mobile ? Smartphone : Laptop;
                return (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <Icon className="size-5 text-fg-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {s.deviceName ?? s.deviceId}{' '}
                        {s.current ? <Badge tone="accent">{t('profile.thisDevice')}</Badge> : null}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {t('profile.lastActive', { time: format.relativeTime(new Date(s.lastUsedAt)) })}
                        {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                      </p>
                    </div>
                    {!s.current ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revoke.mutate(s.id)}
                        loading={revoke.isPending && revoke.variables === s.id}
                      >
                        <LogOut aria-hidden /> {t('profile.signOutDevice')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
        {revoke.error ? <InlineError error={revoke.error} /> : null}
      </CardContent>
    </Card>
  );
}

function NotificationsCard() {
  const t = useTranslations();
  const qc = useQueryClient();
  const q = useNotificationPrefs();
  const save = useMutation({
    mutationFn: (p: NotificationPreferences) =>
      users.updateNotificationPrefs({
        channels: p.channels,
        events: p.events,
        lowBalanceThreshold: p.lowBalanceThreshold,
      }),
    // Non-monetary: optimistic, with rollback.
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: qk.notificationPrefs });
      const prev = qc.getQueryData<NotificationPreferences>(qk.notificationPrefs);
      qc.setQueryData(qk.notificationPrefs, p);
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(qk.notificationPrefs, ctx.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notificationPrefs }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.notifications')}</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState query={q} skeleton={<Skeleton className="h-48" />}>
          {(p) => (
            <div className="grid gap-5">
              <fieldset>
                <legend className="mb-2 text-sm font-medium">{t('profile.channels')}</legend>
                <div className="flex flex-wrap gap-4">
                  {(['push', 'sms', 'email'] as const).map((ch) => (
                    <label key={ch} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={p.channels[ch]}
                        onCheckedChange={(v) => save.mutate({ ...p, channels: { ...p.channels, [ch]: v === true } })}
                      />
                      {t(`profile.${ch}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <ul className="grid gap-2">
                {(Object.keys(p.events) as NotificationEvent[]).map((ev) => {
                  const locked = p.locked.includes(ev);
                  return (
                    <li
                      key={ev}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                    >
                      <span id={`ev-${ev}`}>
                        {t(`profile.events.${ev}`)}
                        {locked ? (
                          <span className="block text-xs text-fg-muted">{t('profile.securityLocked')}</span>
                        ) : null}
                      </span>
                      <Switch
                        aria-labelledby={`ev-${ev}`}
                        checked={p.events[ev] ?? false}
                        disabled={locked}
                        onCheckedChange={(v) => save.mutate({ ...p, events: { ...p.events, [ev]: v } })}
                      />
                    </li>
                  );
                })}
              </ul>
              {save.error ? <InlineError error={save.error} /> : null}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function PreferencesCard() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const qc = useQueryClient();
  const prefs = usePrefs();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const hide = useUiStore((s) => s.hideBalances);
  const toggleHide = useUiStore((s) => s.toggleHideBalances);
  const save = useMutation({
    mutationFn: users.updatePreferences,
    onSuccess: (p) => {
      qc.setQueryData(qk.prefs, p);
      void qc.invalidateQueries({ queryKey: qk.currencies });
      toast.success(t('profile.prefsSaved'));
    },
  });
  const changeLanguage = (l: Locale) => {
    setLocaleCookie(l);
    if (prefs.data) save.mutate({ ...prefs.data, language: l });
    router.refresh();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.preferences')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">{t('profile.language')}</span>
          <Segmented
            label={t('profile.language')}
            value={locale}
            onChange={changeLanguage}
            options={[
              { value: 'en', label: t('profile.english') },
              { value: 'ur', label: t('profile.urdu') },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">{t('profile.theme')}</span>
          <Segmented
            label={t('profile.theme')}
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: t('profile.dark') },
              { value: 'light', label: t('profile.light') },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="pref-currency" className="text-sm font-medium">
            {t('profile.preferredCurrency')}
          </label>
          <Select
            id="pref-currency"
            className="w-32"
            value={prefs.data?.preferredCurrency}
            onValueChange={(v) => prefs.data && save.mutate({ ...prefs.data, preferredCurrency: v as Currency })}
            options={(['PKR', 'AED', 'USD'] as const).map((c) => ({ value: c, label: c }))}
            disabled={!prefs.data}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="pref-hide" className="text-sm font-medium">
            {t('common.hideBalances')}
          </label>
          <Switch id="pref-hide" checked={hide} onCheckedChange={toggleHide} />
        </div>
        {save.error ? <InlineError error={save.error} /> : null}
      </CardContent>
    </Card>
  );
}
