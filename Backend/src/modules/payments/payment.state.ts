import { PaymentStatus } from '@prisma/client';
import { StateMachine } from '../../common/state/state-machine';

/**
 * Payment lifecycle.
 *
 *   CREATED -> PROCESSING -> COMPLETED -> PARTIALLY_REFUNDED -> REFUNDED
 *      |           |            |  \___________________________/^
 *      v           v            v
 *    FAILED   FAILED/REVERSED  REFUNDED
 *
 * PROCESSING -> FAILED:   business failure (funds, limits, QR already paid) or timeout with no money moved.
 * PROCESSING -> REVERSED: timeout compensation when an entry exists without completion (defensive; the
 *                         engine posts and completes atomically, so this needs manual corruption).
 */
export const paymentMachine = new StateMachine<PaymentStatus>('Payment', {
  CREATED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED', 'REVERSED'],
  COMPLETED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: [],
  REVERSED: [],
  REFUNDED: [],
});

/** Status after refunding `refundedTotal` of `amount`. */
export function statusAfterRefund(amount: bigint, refundedTotal: bigint): PaymentStatus {
  return refundedTotal >= amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}
