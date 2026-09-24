import { DomainError } from '../../src/common/errors/domain-error';
import { StateMachine, appendTimeline, readTimeline } from '../../src/common/state/state-machine';
import { bankOutcomeOfEventType, fundingMachine, planBankOutcome } from '../../src/modules/funding/funding.state';
import { merchantMachine, refundMachine } from '../../src/modules/merchants/merchant.state';
import { paymentMachine, statusAfterRefund } from '../../src/modules/payments/payment.state';
import { settlementMachine } from '../../src/modules/settlement/settlement.math';
import { effectiveRequestStatus, paymentRequestMachine } from '../../src/modules/transfers/payment-request.state';

function allPairs<S extends string>(m: StateMachine<S>): Array<[S, S]> {
  return m.states.flatMap((a) => m.states.map((b) => [a, b] as [S, S]));
}

describe('state machines', () => {
  it('Payment: explicit transitions; terminal states accept nothing', () => {
    expect(paymentMachine.can('CREATED', 'PROCESSING')).toBe(true);
    expect(paymentMachine.can('PROCESSING', 'COMPLETED')).toBe(true);
    expect(paymentMachine.can('PROCESSING', 'REVERSED')).toBe(true);
    expect(paymentMachine.can('COMPLETED', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(paymentMachine.can('PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(paymentMachine.can('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true);
    for (const illegal of [
      ['CREATED', 'COMPLETED'],
      ['FAILED', 'COMPLETED'],
      ['COMPLETED', 'FAILED'],
      ['REFUNDED', 'PARTIALLY_REFUNDED'],
      ['COMPLETED', 'PROCESSING'],
    ] as const) {
      expect(paymentMachine.can(illegal[0], illegal[1])).toBe(false);
    }
    for (const t of ['FAILED', 'REVERSED', 'REFUNDED'] as const) expect(paymentMachine.isTerminal(t)).toBe(true);
  });

  it('illegal transitions throw INVALID_STATE_TRANSITION with details', () => {
    let err: unknown;
    try {
      fundingMachine.assert('FAILED', 'SUCCEEDED');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409, details: { entity: 'FundingTransaction', from: 'FAILED', to: 'SUCCEEDED' } });
  });

  it('every machine: assert agrees with can() for all pairs', () => {
    const machines = [paymentMachine, fundingMachine, paymentRequestMachine, refundMachine, settlementMachine, merchantMachine] as Array<
      StateMachine<string>
    >;
    for (const m of machines) {
      for (const [a, b] of allPairs(m)) {
        if (m.can(a, b)) expect(() => m.assert(a, b)).not.toThrow();
        else expect(() => m.assert(a, b)).toThrow(DomainError);
      }
    }
  });

  it('FundingTransaction, PaymentRequest, Refund and Settlement tables', () => {
    expect(fundingMachine.targets('PENDING')).toEqual(['SUCCEEDED', 'FAILED']);
    expect(fundingMachine.targets('SUCCEEDED')).toEqual(['REVERSED']);
    expect(fundingMachine.isTerminal('REVERSED')).toBe(true);
    expect(paymentRequestMachine.targets('PENDING')).toEqual(['ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED']);
    expect(paymentRequestMachine.isTerminal('ACCEPTED')).toBe(true);
    expect(refundMachine.targets('PENDING')).toEqual(['COMPLETED', 'FAILED']);
    expect(settlementMachine.targets('PENDING')).toEqual(['PAID', 'FAILED']);
    expect(settlementMachine.can('PAID', 'FAILED')).toBe(false);
    expect(merchantMachine.can('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(merchantMachine.can('ACTIVE', 'PENDING_REVIEW')).toBe(false);
  });

  it('plans out-of-order bank outcomes: apply, ignore, defer or flag', () => {
    expect(planBankOutcome('PENDING', 'SUCCEEDED')).toBe('APPLY');
    expect(planBankOutcome('PENDING', 'FAILED')).toBe('APPLY');
    expect(planBankOutcome('SUCCEEDED', 'REVERSED')).toBe('APPLY');
    expect(planBankOutcome('SUCCEEDED', 'SUCCEEDED')).toBe('IGNORE');
    expect(planBankOutcome('PENDING', 'REVERSED')).toBe('DEFER');
    expect(planBankOutcome('FAILED', 'SUCCEEDED')).toBe('FLAG');
    expect(planBankOutcome('SUCCEEDED', 'FAILED')).toBe('FLAG');
    expect(planBankOutcome('REVERSED', 'SUCCEEDED')).toBe('FLAG');
    expect(planBankOutcome('FAILED', 'REVERSED')).toBe('FLAG');
    expect(bankOutcomeOfEventType('transaction.succeeded')).toBe('SUCCEEDED');
    expect(bankOutcomeOfEventType('transaction.nope')).toBeNull();
  });

  it('refund status and request expiry helpers', () => {
    expect(statusAfterRefund(1000n, 400n)).toBe('PARTIALLY_REFUNDED');
    expect(statusAfterRefund(1000n, 1000n)).toBe('REFUNDED');
    const now = new Date('2026-09-24T12:00:00Z');
    expect(effectiveRequestStatus('PENDING', new Date('2026-09-24T11:59:59Z'), now)).toBe('EXPIRED');
    expect(effectiveRequestStatus('PENDING', new Date('2026-09-24T12:00:01Z'), now)).toBe('PENDING');
    expect(effectiveRequestStatus('ACCEPTED', new Date('2026-01-01T00:00:00Z'), now)).toBe('ACCEPTED');
  });

  it('timelines are appended immutably', () => {
    const t0 = [{ status: 'PENDING', at: '2026-09-24T00:00:00.000Z' }];
    const t1 = appendTimeline(t0, 'SUCCEEDED', 'bank confirmed', new Date('2026-09-24T00:01:00Z'));
    expect(t0).toHaveLength(1);
    expect(t1).toEqual([...t0, { status: 'SUCCEEDED', at: '2026-09-24T00:01:00.000Z', reason: 'bank confirmed' }]);
    expect(readTimeline(null)).toEqual([]);
  });
});
