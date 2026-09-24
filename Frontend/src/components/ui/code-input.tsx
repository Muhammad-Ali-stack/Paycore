'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Segmented code entry (PIN / OTP). A single real <input> carries the value, the
 * label and the keyboard; the boxes are presentation. Screen readers hear one
 * labelled field; digits are masked when `mask` is set.
 */
export const CodeInput = React.forwardRef<
  HTMLInputElement,
  {
    length: number;
    value: string;
    onChange: (v: string) => void;
    onComplete?: (v: string) => void;
    mask?: boolean;
    disabled?: boolean;
    autoFocus?: boolean;
    id?: string;
    'aria-label'?: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
    name?: string;
    /** Allow fewer digits than `length` (4–6 digit PINs). */
    minLength?: number;
    className?: string;
  }
>(({ length, value, onChange, onComplete, mask, disabled, autoFocus, className, minLength, ...aria }, ref) => {
  const innerRef = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => innerRef.current!);
  const [focused, setFocused] = React.useState(false);
  return (
    <div dir="ltr" className={cn('relative inline-flex gap-2', className)} onClick={() => innerRef.current?.focus()}>
      <input
        ref={innerRef}
        type={mask ? 'password' : 'text'}
        inputMode="numeric"
        autoComplete={mask ? 'off' : 'one-time-code'}
        pattern="[0-9]*"
        maxLength={length}
        minLength={minLength}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, length);
          onChange(v);
          if (v.length === length) onComplete?.(v);
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
        {...aria}
      />
      {Array.from({ length }, (_, i) => {
        const ch = value[i];
        const active = focused && (i === value.length || (i === length - 1 && value.length === length));
        return (
          <span
            key={i}
            aria-hidden
            className={cn(
              'flex size-12 items-center justify-center rounded-md border bg-raised text-xl font-semibold transition-colors',
              active ? 'border-accent shadow-[0_0_0_3px_var(--pc-accent-tint)]' : 'border-border',
              aria['aria-invalid'] && 'border-danger',
              minLength !== undefined && i >= minLength && 'border-dashed',
            )}
          >
            {ch ? mask ? <span className="size-2.5 rounded-full bg-fg" /> : <span className="money">{ch}</span> : null}
          </span>
        );
      })}
    </div>
  );
});
CodeInput.displayName = 'CodeInput';
