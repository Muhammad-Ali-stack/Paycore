import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { tokenGroups, radius } from '@/design/tokens';

function Swatch({ name }: { name: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="h-14 w-full rounded-md border border-border" style={{ background: `var(--pc-${name})` }} />
      <code className="code text-xs text-fg-muted">--pc-{name}</code>
    </div>
  );
}

function Tokens() {
  return (
    <div className="grid gap-8">
      {Object.entries(tokenGroups).map(([group, names]) => (
        <section key={group} className="grid gap-3">
          <h2 className="text-sm font-semibold">{group}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {names.map((n) => (
              <Swatch key={n} name={n} />
            ))}
          </div>
        </section>
      ))}
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Typography</h2>
        <p className="text-4xl font-semibold tracking-tight">Inter · Balances large and confident</p>
        <p className="money text-3xl font-semibold">Rs 1,234,567.89 · $9,876.54</p>
        <p className="code text-sm text-fg-muted">JetBrains Mono · PK36 MEZN 0000 0012 3456 7890</p>
        <p lang="ur" className="text-xl" style={{ fontFamily: 'var(--pc-font-urdu)' }}>
          اردو متن کی مثال
        </p>
      </section>
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Radii</h2>
        <div className="flex gap-4">
          {Object.entries(radius).map(([k, v]) => (
            <div key={k} className="grid justify-items-center gap-1">
              <div className="size-16 border border-border-strong bg-raised" style={{ borderRadius: v }} />
              <code className="code text-xs text-fg-muted">
                {k} · {v}px
              </code>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Surfaces</h2>
        <div className="balance-surface h-32 rounded-xl border border-border p-4 text-sm text-fg-muted">
          Balance card gradient (the only gradient)
        </div>
        <div className="card-surface h-32 rounded-xl border border-border-strong p-4 text-sm text-[var(--pc-card-fg)]">
          Virtual card surface
        </div>
      </section>
    </div>
  );
}

const meta = { title: 'Design system/Tokens', component: Tokens } satisfies Meta<typeof Tokens>;
export default meta;
export const All: StoryObj<typeof meta> = {};
