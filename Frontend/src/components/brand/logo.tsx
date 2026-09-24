import { cn } from '@/lib/utils';

/**
 * PayCore mark: three isometric stacked blocks (slate outlines) with a rising
 * three-bar chart in gold on the top face. Colours come from tokens
 * (--pc-logo-*), so the mark adapts to the light theme.
 *
 * Placeholder artwork: replace with the official logo (see README "Brand assets").
 */
export function LogoMark({ className, title = 'PayCore' }: { className?: string; title?: string | null }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('size-8', className)}
      role={title ? 'img' : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* Bottom block */}
      <path d="M8 44 32 56 56 44 32 32Z" fill="var(--pc-logo-fill)" stroke="var(--pc-logo-outline)" strokeWidth="1.6" />
      <path d="M8 44v4l24 12 24-12v-4" stroke="var(--pc-logo-outline)" strokeWidth="1.6" />
      {/* Middle block */}
      <path
        d="M12 34 32 44 52 34 32 24Z"
        fill="var(--pc-logo-fill)"
        stroke="var(--pc-logo-outline)"
        strokeWidth="1.6"
      />
      <path d="M12 34v4l20 10 20-10v-4" stroke="var(--pc-logo-outline)" strokeWidth="1.6" />
      {/* Top block */}
      <path
        d="M16 24 32 32 48 24 32 16Z"
        fill="var(--pc-logo-fill)"
        stroke="var(--pc-logo-outline)"
        strokeWidth="1.6"
      />
      <path d="M16 24v4l16 8 16-8v-4" stroke="var(--pc-logo-outline)" strokeWidth="1.6" />
      {/* Rising bars (gold) standing on the top face */}
      <path d="M24 24v-5l3 1.5v5Z" fill="var(--pc-logo-accent)" />
      <path d="M30.5 27.2V15l3 1.5v12.2Z" fill="var(--pc-logo-accent)" />
      <path d="M37 24V7l3 1.5V22.5Z" fill="var(--pc-logo-accent)" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark title={compact ? 'PayCore' : null} />
      {compact ? null : (
        <span className="text-[17px] font-semibold tracking-tight text-fg">
          Pay<span className="text-accent-text">Core</span>
        </span>
      )}
    </span>
  );
}
