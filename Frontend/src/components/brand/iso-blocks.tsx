import { cn } from '@/lib/utils';

/**
 * Isometric block motif from the logo. Used sparingly: empty states, the loading
 * mark and KYC tier visuals. `filled` blocks get the gold tint (e.g. tiers reached).
 */
export function IsoBlocks({
  count = 3,
  filled = 0,
  className,
  animate,
}: {
  count?: number;
  filled?: number;
  className?: string;
  animate?: boolean;
}) {
  const h = 12; // vertical step per block
  const height = 40 + count * h;
  return (
    <svg
      viewBox={`0 0 80 ${height}`}
      className={cn('h-20 w-auto', className)}
      aria-hidden
      fill="none"
      strokeLinejoin="round"
    >
      {Array.from({ length: count }, (_, i) => {
        const y = height - 26 - i * h; // bottom block first
        const on = i < filled;
        const w = 30 - i * 4;
        const cx = 40;
        return (
          <g
            key={i}
            style={animate ? { animation: `pc-block-rise 1.6s ${i * 0.18}s var(--pc-ease) infinite both` } : undefined}
          >
            <path
              d={`M${cx - w} ${y} L${cx} ${y + w / 2} L${cx + w} ${y} L${cx} ${y - w / 2}Z`}
              fill={on ? 'var(--pc-accent-tint)' : 'var(--pc-raised)'}
              stroke={on ? 'var(--pc-accent)' : 'var(--pc-fg-subtle)'}
              strokeWidth="1.2"
            />
            <path
              d={`M${cx - w} ${y} v5 L${cx} ${y + w / 2 + 5} L${cx + w} ${y + 5} v-5`}
              stroke={on ? 'var(--pc-accent)' : 'var(--pc-fg-subtle)'}
              strokeWidth="1.2"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function LoadingMark({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-10 text-fg-muted">
      <IsoBlocks count={3} animate className="h-16" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
