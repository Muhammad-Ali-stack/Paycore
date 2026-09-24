'use client';

import * as React from 'react';
import { exponentOf } from '@/lib/money';
import { cn } from '@/lib/utils';

const SYMBOL: Record<string, string> = { PKR: 'Rs', AED: 'AED', USD: '$' };

/**
 * Large amount entry. Keeps the raw string (never a number); parse with
 * parseAmountInput() from lib/money. Only digits, one separator and at most
 * `exponent` decimals can be typed.
 */
export const AmountInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> & {
    value: string;
    onValueChange: (v: string) => void;
    currency: string;
    size?: 'md' | 'lg';
  }
>(({ value, onValueChange, currency, className, size = 'lg', ...props }, ref) => {
  const exp = exponentOf(currency);
  return (
    <div
      dir="ltr"
      className={cn(
        'flex items-baseline gap-2 rounded-lg border border-border bg-raised px-4 transition-colors focus-within:border-accent hover:border-border-strong has-[input[aria-invalid=true]]:border-danger',
        size === 'lg' ? 'py-4' : 'py-2.5',
      )}
    >
      <span className={cn('font-medium text-fg-muted', size === 'lg' ? 'text-xl' : 'text-sm')} aria-hidden>
        {SYMBOL[currency] ?? currency}
      </span>
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={exp > 0 ? `0.${'0'.repeat(exp)}` : '0'}
        value={value}
        onChange={(e) => {
          let v = e.target.value.replace(/[^\d.,٠-٩۰-۹٫]/g, '').replace(/,/g, '');
          const firstDot = v.indexOf('.');
          if (firstDot !== -1) {
            v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
            const [i, f = ''] = v.split('.');
            v = `${i}.${f.slice(0, exp)}`;
          }
          onValueChange(v);
        }}
        className={cn(
          'money w-full min-w-0 bg-transparent text-fg outline-none placeholder:text-fg-muted/50',
          size === 'lg' ? 'text-4xl font-semibold' : 'text-lg font-medium',
          className,
        )}
        {...props}
      />
      <span className="text-sm font-medium text-fg-muted">{currency}</span>
    </div>
  );
});
AmountInput.displayName = 'AmountInput';
