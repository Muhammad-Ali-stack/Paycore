'use client';

/** Thin, themed wrappers over Radix primitives (shadcn/ui style). */
import * as React from 'react';
import {
  Avatar as AvatarP,
  Checkbox as CheckboxP,
  DropdownMenu as DM,
  Progress as ProgressP,
  Select as SelectP,
  Separator as SeparatorP,
  Switch as SwitchP,
  Tabs as TabsP,
  Tooltip as TooltipP,
} from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { inputClass } from './input';

/* --------------------------------- Tabs ---------------------------------- */

export const Tabs = TabsP.Root;
export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsP.List>) {
  return (
    <TabsP.List
      className={cn('inline-flex h-10 items-center gap-1 rounded-md border border-border bg-surface p-1', className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsP.Trigger>) {
  return (
    <TabsP.Trigger
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-sm px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-raised data-[state=active]:text-fg data-[state=active]:shadow-[inset_0_-2px_0_var(--pc-accent)]',
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsP.Content;

/* -------------------------------- Switch --------------------------------- */

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchP.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchP.Root>
>(({ className, ...props }, ref) => (
  <SwitchP.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border bg-raised transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent',
      className,
    )}
    {...props}
  >
    <SwitchP.Thumb className="block size-4.5 rounded-full bg-fg-muted shadow transition-transform duration-150 data-[state=checked]:bg-accent-fg ltr:translate-x-0.5 ltr:data-[state=checked]:translate-x-[22px] rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-[22px]" />
  </SwitchP.Root>
));
Switch.displayName = 'Switch';

/* ------------------------------- Checkbox -------------------------------- */

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxP.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxP.Root>
>(({ className, ...props }, ref) => (
  <CheckboxP.Root
    ref={ref}
    className={cn(
      'inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-raised data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg',
      className,
    )}
    {...props}
  >
    <CheckboxP.Indicator>
      <Check className="size-3.5" aria-hidden />
    </CheckboxP.Indicator>
  </CheckboxP.Root>
));
Checkbox.displayName = 'Checkbox';

/* -------------------------------- Select --------------------------------- */

export type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean };

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  id,
  disabled,
  ...aria
}: {
  value?: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  return (
    <SelectP.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectP.Trigger id={id} className={cn(inputClass, 'justify-between gap-2 text-start', className)} {...aria}>
        <SelectP.Value placeholder={placeholder} />
        <SelectP.Icon>
          <ChevronDown className="size-4 text-fg-muted" aria-hidden />
        </SelectP.Icon>
      </SelectP.Trigger>
      <SelectP.Portal>
        <SelectP.Content
          position="popper"
          sideOffset={6}
          className="z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] animate-[pc-fade-in_120ms_ease-out] overflow-hidden rounded-md border border-border bg-raised shadow-card"
        >
          <SelectP.Viewport className="p-1">
            {options.map((o) => (
              <SelectP.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-9 cursor-pointer items-center rounded-sm ps-8 pe-3 text-sm text-fg outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-tint data-[highlighted]:text-fg"
              >
                <SelectP.ItemIndicator className="absolute start-2 inline-flex">
                  <Check className="size-4 text-accent" aria-hidden />
                </SelectP.ItemIndicator>
                <SelectP.ItemText>{o.label}</SelectP.ItemText>
              </SelectP.Item>
            ))}
          </SelectP.Viewport>
        </SelectP.Content>
      </SelectP.Portal>
    </SelectP.Root>
  );
}

/* ------------------------------- Progress -------------------------------- */

export function Progress({ value, className, label }: { value: number; className?: string; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <ProgressP.Root
      value={v}
      aria-label={label}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-raised', className)}
    >
      <ProgressP.Indicator
        className="h-full rounded-full bg-accent transition-[width] duration-500 ease-pc"
        style={{ width: `${v}%` }}
      />
    </ProgressP.Root>
  );
}

/* ------------------------------- Separator ------------------------------- */

export function Separator({ className, ...props }: React.ComponentPropsWithoutRef<typeof SeparatorP.Root>) {
  return (
    <SeparatorP.Root
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------- Avatar --------------------------------- */

export function Avatar({
  name,
  className,
  tone = 'slate',
}: {
  name: string;
  className?: string;
  tone?: 'slate' | 'gold';
}) {
  return (
    <AvatarP.Root
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
        tone === 'gold' ? 'border-accent/40 bg-accent-tint text-accent-text' : 'border-border bg-raised text-fg-muted',
        className,
      )}
    >
      <AvatarP.Fallback aria-hidden>{initials(name) || '?'}</AvatarP.Fallback>
    </AvatarP.Root>
  );
}

/* -------------------------------- Tooltip -------------------------------- */

export const TooltipProvider = TooltipP.Provider;
export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactElement }) {
  return (
    <TooltipP.Root>
      <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content
          sideOffset={6}
          className="z-[70] rounded-md border border-border bg-raised px-2.5 py-1.5 text-xs text-fg shadow-card"
        >
          {content}
        </TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  );
}

/* ----------------------------- Dropdown menu ----------------------------- */

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={6}
        align="end"
        className={cn(
          'z-[60] min-w-48 animate-[pc-fade-in_120ms_ease-out] rounded-md border border-border bg-raised p-1 shadow-card',
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm text-fg outline-none data-[highlighted]:bg-accent-tint [&_svg]:size-4 [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}
export const DropdownMenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;
export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DM.Label>) {
  return <DM.Label className={cn('px-2.5 py-1.5 text-xs text-fg-muted', className)} {...props} />;
}

/* --------------------------- Segmented control --------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-md border border-border bg-surface p-1', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              const dir = document.dir === 'rtl' ? -1 : 1;
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const step = (e.key === 'ArrowRight' ? 1 : -1) * dir;
                const next = options[(i + step + options.length) % options.length];
                if (next) onChange(next.value);
              }
            }}
            tabIndex={active ? 0 : -1}
            className={cn(
              'h-8 rounded-sm px-3 text-sm font-medium transition-colors',
              active ? 'bg-raised text-fg shadow-[inset_0_-2px_0_var(--pc-accent)]' : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
