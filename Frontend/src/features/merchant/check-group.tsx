'use client';

import * as React from 'react';
import { Checkbox } from '@/components/ui/primitives';
import { Label } from '@/components/ui/input';

/** A labelled group of checkboxes over a string[] value (fieldset + legend). */
export function CheckGroup({
  legend,
  options,
  value,
  onChange,
  error,
  testIdPrefix,
}: {
  legend: string;
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
  testIdPrefix?: string;
}) {
  const id = React.useId();
  return (
    <fieldset
      className="grid gap-2"
      aria-describedby={error ? `${id}-err` : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const cid = `${id}-${o}`;
          const checked = value.includes(o);
          return (
            <div key={o} className="flex items-center gap-2 rounded-md border border-border bg-raised px-3 py-2">
              <Checkbox
                id={cid}
                checked={checked}
                data-testid={testIdPrefix ? `${testIdPrefix}-${o}` : undefined}
                onCheckedChange={(c) => onChange(c === true ? [...value, o] : value.filter((x) => x !== o))}
              />
              <Label htmlFor={cid} className="code cursor-pointer text-xs font-normal">
                {o}
              </Label>
            </div>
          );
        })}
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
