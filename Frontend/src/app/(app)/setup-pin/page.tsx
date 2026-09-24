'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, PasswordInput } from '@/components/ui/input';
import { CodeInput } from '@/components/ui/code-input';
import { InlineError } from '@/components/states/states';
import { qk, useQueryClient } from '@/lib/api/hooks';
import { auth } from '@/lib/api/services';
import { setPinSchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';

/** PIN setup (POST /auth/pin {password, pin}). */
export default function SetupPinPage() {
  const t = useTranslations();
  const fe = useFieldError();
  const router = useRouter();
  const qc = useQueryClient();
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});
  const set = useMutation({
    mutationFn: () => auth.setPin({ password, pin }),
    onSuccess: async () => {
      toast.success(t('auth.pinSet'));
      await qc.invalidateQueries({ queryKey: qk.me });
      router.replace('/home');
    },
  });
  return (
    <div className="mx-auto grid w-full max-w-md gap-6">
      <Card>
        <CardContent className="grid gap-5 pt-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-full border border-accent/30 bg-accent-tint text-accent">
              <LockKeyhole className="size-6" aria-hidden />
            </span>
            <h1 className="text-xl font-semibold">{t('auth.pinTitle')}</h1>
            <p className="text-sm text-fg-muted">{t('auth.pinSubtitle')}</p>
          </div>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const r = setPinSchema.safeParse({ password, pin, confirmPin });
              if (!r.success) {
                setErrors(
                  Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), fe({ message: i.message })])),
                );
                return;
              }
              setErrors({});
              set.mutate();
            }}
          >
            <Field label={t('auth.pinCurrentPassword')} error={errors.password}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                showLabel={t('auth.showPassword')}
                hideLabel={t('auth.hidePassword')}
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t('auth.pin')}</span>
              <CodeInput
                length={6}
                minLength={4}
                mask
                value={pin}
                onChange={setPin}
                aria-label={t('auth.pin')}
                aria-invalid={errors.pin ? true : undefined}
              />
              {errors.pin ? (
                <p role="alert" className="text-xs text-danger">
                  {errors.pin}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t('auth.pinConfirm')}</span>
              <CodeInput
                length={6}
                minLength={4}
                mask
                value={confirmPin}
                onChange={setConfirmPin}
                aria-label={t('auth.pinConfirm')}
                aria-invalid={errors.confirmPin ? true : undefined}
              />
              {errors.confirmPin ? (
                <p role="alert" className="text-xs text-danger">
                  {errors.confirmPin}
                </p>
              ) : null}
            </div>
            {set.error ? <InlineError error={set.error} /> : null}
            <Button type="submit" size="lg" block loading={set.isPending}>
              {t('common.save')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
