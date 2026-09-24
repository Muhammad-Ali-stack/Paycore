import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/logo';
import { IsoBlocks } from '@/components/brand/iso-blocks';
import { LanguageSwitcher } from '@/components/layout/language-switcher';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('auth');
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="balance-surface relative hidden flex-col justify-between overflow-hidden border-e border-border p-12 lg:flex">
        <Logo />
        <div className="max-w-md space-y-6">
          <IsoBlocks count={4} filled={1} className="h-40" />
          <p className="text-3xl leading-tight font-semibold tracking-tight text-fg">{t('tagline')}</p>
        </div>
        <p className="text-xs text-fg-muted">© PayCore</p>
      </aside>
      <main id="main" className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <span className="lg:invisible">
            <Logo />
          </span>
          <LanguageSwitcher />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
