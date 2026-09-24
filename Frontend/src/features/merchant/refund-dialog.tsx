'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/primitives';
import { InlineError } from '@/components/states/states';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { refundSchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { useQueryClient } from '@/lib/api/hooks';
import { merchant } from '@/lib/api/services';
import type { MerchantPayment } from '@/lib/api/contracts/phase2';
import { minorToDecimalString, moneyFromMinor, parseAmountInput } from '@/lib/money';

type RefundArgs = { id: string; body: { amount?: string; reason: string } };
const sendRefund = (a: RefundArgs, key: string) => merchant.refund(a.id, a.body, key);

/** Refundable remainder in minor units (gross − already refunded). */
export function refundableMinor(p: MerchantPayment): bigint {
  const r = BigInt(p.amount.amountMinor) - BigInt(p.refundedAmount.amountMinor);
  return r > 0n ? r : 0n;
}

export function canRefund(p: MerchantPayment) {
  return (p.status === 'COMPLETED' || p.status === 'PARTIALLY_REFUNDED') && refundableMinor(p) > 0n;
}

export function RefundDialog({
  payment,
  open,
  onOpenChange,
}: {
  payment: MerchantPayment;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const qc = useQueryClient();
  const currency = payment.amount.currency;
  const max = refundableMinor(payment);
  const action = useIdempotentAction(sendRefund);
  const schema = React.useMemo(() => refundSchema(currency, max), [currency, max]);
  type Form = z.input<typeof schema>;
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { mode: 'FULL', amount: '', reason: '' },
  });
  const mode = useWatch({ control: form.control, name: 'mode' });

  // One Idempotency-Key per opening of the confirm dialog.
  const { begin, reset: resetAction } = action;
  React.useEffect(() => {
    if (open) {
      begin();
      form.reset({ mode: 'FULL', amount: '', reason: '' });
    } else {
      resetAction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (v) => {
    let amount: string;
    if (v.mode === 'FULL') amount = minorToDecimalString(max, currency);
    else {
      const r = parseAmountInput(v.amount, currency);
      if (!r.ok) return;
      amount = r.normalized;
    }
    try {
      await action.run({ id: payment.id, body: { amount, reason: v.reason.trim() } });
      toast.success(t('refundDone'));
      await qc.invalidateQueries({ queryKey: ['merchant'] });
      onOpenChange(false);
    } catch {
      /* shown inline via action.error */
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !action.pending && onOpenChange(o)}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('refundTitle')}</DialogTitle>
          <DialogDescription>
            {t('refundableLabel')}: <Amount money={moneyFromMinor(max, currency)} className="font-medium text-fg" />
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-fg">{t('refundType')}</span>
            <Segmented
              label={t('refundType')}
              value={mode}
              onChange={(m) => form.setValue('mode', m, { shouldValidate: form.formState.isSubmitted })}
              options={[
                { value: 'FULL', label: t('refundFull') },
                { value: 'PARTIAL', label: t('refundPartial') },
              ]}
            />
          </div>
          {mode === 'PARTIAL' ? (
            <Field label={t('refundAmount')} error={fe(form.formState.errors.amount)}>
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <AmountInput
                    size="md"
                    currency={currency}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    data-testid="refund-amount"
                  />
                )}
              />
            </Field>
          ) : (
            <div className="flex items-center justify-between rounded-md border border-border bg-raised px-3 py-2.5 text-sm">
              <span className="text-fg-muted">{t('refundAmount')}</span>
              <Amount money={moneyFromMinor(max, currency)} className="font-medium" />
            </div>
          )}
          <Field label={t('refundReason')} error={fe(form.formState.errors.reason)}>
            <Textarea
              rows={3}
              maxLength={200}
              placeholder={t('refundReasonPlaceholder')}
              data-testid="refund-reason"
              {...form.register('reason')}
            />
          </Field>
          {action.status === 'retrying' ? (
            <p role="status" className="text-xs text-fg-muted">
              {t('retrying')}
            </p>
          ) : null}
          {action.error ? <InlineError error={action.error} /> : null}
          <DialogFooter className="mt-1">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={action.pending}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={action.pending} data-testid="refund-submit">
              {t('issueRefund')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
