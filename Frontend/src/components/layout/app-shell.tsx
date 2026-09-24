'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  ClipboardCheck,
  Code2,
  CreditCard,
  Eye,
  EyeOff,
  FileSearch,
  Gauge,
  History,
  Home,
  Landmark,
  LogOut,
  QrCode,
  Receipt,
  ScanLine,
  Search,
  Send,
  ShieldAlert,
  Store,
  Undo2,
  User,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { Logo, LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/primitives';
import { OfflineBanner } from '@/components/states/states';
import { AutoLock } from './auto-lock';
import { auth } from '@/lib/api/services';
import { useMe } from '@/lib/api/hooks';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

export type Portal = 'consumer' | 'merchant' | 'admin';

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };

function useNav(portal: Portal): { items: Item[]; mobile: Item[] } {
  const t = useTranslations('nav');
  if (portal === 'merchant') {
    const items: Item[] = [
      { href: '/merchant', label: t('merchant.dashboard'), icon: Gauge, exact: true },
      { href: '/merchant/qr', label: t('merchant.qr'), icon: QrCode },
      { href: '/merchant/payments', label: t('merchant.payments'), icon: Receipt },
      { href: '/merchant/refunds', label: t('merchant.refunds'), icon: Undo2 },
      { href: '/merchant/settlements', label: t('merchant.settlements'), icon: Landmark },
      { href: '/merchant/outlets', label: t('merchant.outlets'), icon: Store },
      { href: '/merchant/developers', label: t('merchant.developers'), icon: Code2 },
    ];
    return { items, mobile: [items[0]!, items[1]!, items[2]!, items[4]!, items[6]!] };
  }
  if (portal === 'admin') {
    const items: Item[] = [
      { href: '/admin', label: t('admin.overview'), icon: Gauge, exact: true },
      { href: '/admin/kyc', label: t('admin.kyc'), icon: UserCheck },
      { href: '/admin/fraud', label: t('admin.fraud'), icon: ShieldAlert },
      { href: '/admin/search', label: t('admin.search'), icon: Search },
      { href: '/admin/approvals', label: t('admin.approvals'), icon: ClipboardCheck },
      { href: '/admin/merchants', label: t('admin.merchants'), icon: Building2 },
      { href: '/admin/audit', label: t('admin.audit'), icon: FileSearch },
    ];
    return { items, mobile: [items[0]!, items[1]!, items[2]!, items[3]!, items[4]!] };
  }
  const items: Item[] = [
    { href: '/home', label: t('home'), icon: Home },
    { href: '/send', label: t('send'), icon: Send },
    { href: '/scan', label: t('scan'), icon: ScanLine },
    { href: '/activity', label: t('activity'), icon: History },
    { href: '/cards', label: t('cards'), icon: CreditCard },
    { href: '/bills', label: t('bills'), icon: Receipt },
    { href: '/topup', label: t('topup'), icon: Wallet },
    { href: '/requests', label: t('requests'), icon: ArrowLeftRight },
    { href: '/analytics', label: t('analytics'), icon: BarChart3 },
    { href: '/profile', label: t('profile'), icon: User },
  ];
  return { items, mobile: [items[0]!, items[1]!, items[2]!, items[3]!, items[9]!] };
}

function isActive(pathname: string, item: Item) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function UserMenu({ portal }: { portal: Portal }) {
  const t = useTranslations();
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const lock = useUiStore((s) => s.lock);
  const name = me.data?.fullName ?? '';
  const signOut = async () => {
    await auth.logout().catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full p-0.5 hover:bg-raised"
          aria-label={t('common.openMenu')}
          data-testid="user-menu"
        >
          <Avatar name={name || 'P C'} className="size-9" tone="gold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {name ? <DropdownMenuLabel>{name}</DropdownMenuLabel> : null}
        {portal === 'consumer' ? (
          <DropdownMenuItem onSelect={() => router.push('/profile')}>
            <User aria-hidden /> {t('nav.profile')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => lock()}>
          <LogoMark title={null} className="size-4" /> {t('lock.lockNow')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} data-testid="sign-out">
          <LogOut aria-hidden /> {t('common.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HideBalancesToggle() {
  const t = useTranslations('common');
  const hidden = useUiStore((s) => s.hideBalances);
  const toggle = useUiStore((s) => s.toggleHideBalances);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? t('showBalances') : t('hideBalances')}
    >
      {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
    </Button>
  );
}

export function AppShell({ portal, children }: { portal: Portal; children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { items, mobile } = useNav(portal);

  return (
    <>
      <AutoLock />
      <div id="app-frame" className="min-h-dvh bg-bg">
        <OfflineBanner />
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-border bg-surface lg:flex">
          <div className="flex h-16 items-center px-5">
            <Link href={items[0]!.href} aria-label="PayCore" className="rounded-md">
              <Logo />
            </Link>
          </div>
          {portal !== 'consumer' ? (
            <p className="px-5 pb-2 text-xs font-medium tracking-wider text-fg-muted uppercase">
              {t(`portal.${portal}`)}
            </p>
          ) : null}
          <nav aria-label={t('primary')} className="flex-1 overflow-y-auto px-3 py-2">
            <ul className="grid gap-0.5">
              {items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                        active ? 'bg-accent-tint text-accent-text' : 'text-fg-muted hover:bg-raised hover:text-fg',
                      )}
                    >
                      {active ? (
                        <span aria-hidden className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-accent" />
                      ) : null}
                      <Icon className="size-[18px]" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center justify-between border-t border-border p-3">
            <UserMenu portal={portal} />
            <HideBalancesToggle />
          </div>
        </aside>

        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/85 px-4 backdrop-blur lg:hidden">
          <Link href={items[0]!.href} aria-label="PayCore" className="rounded-md">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <HideBalancesToggle />
            <UserMenu portal={portal} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="pb-24 outline-none lg:ps-64 lg:pb-10">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
        </main>

        {/* Mobile bottom tab bar */}
        <nav
          aria-label={t('primary')}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {mobile.map((item, i) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              const center = portal === 'consumer' && i === 2;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                      active ? 'text-accent-text' : 'text-fg-muted',
                    )}
                  >
                    {center ? (
                      <span className="-mt-5 inline-flex size-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_6px_20px_-6px_var(--pc-accent-glow)]">
                        <Icon className="size-5" aria-hidden />
                      </span>
                    ) : (
                      <Icon className="size-5" aria-hidden />
                    )}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
            <span aria-hidden className="rtl:rotate-180">
              ←
            </span>{' '}
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
