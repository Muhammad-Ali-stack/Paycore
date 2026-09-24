import { PaymentRequestStatus } from '@prisma/client';
import { StateMachine } from '../../common/state/state-machine';

/**
 * PENDING -> ACCEPTED (payer paid; claimed inside the payment transaction)
 * PENDING -> DECLINED (payer) | CANCELLED (requester) | EXPIRED (expiry job, or lazily on access)
 */
export const paymentRequestMachine = new StateMachine<PaymentRequestStatus>('PaymentRequest', {
  PENDING: ['ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: [],
  DECLINED: [],
  CANCELLED: [],
  EXPIRED: [],
});

/** The status a client should see (an unexpired-by-job request past its expiry reads as EXPIRED). */
export function effectiveRequestStatus(status: PaymentRequestStatus, expiresAt: Date, now = new Date()): PaymentRequestStatus {
  return status === 'PENDING' && expiresAt <= now ? 'EXPIRED' : status;
}
