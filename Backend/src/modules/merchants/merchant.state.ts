import { MerchantStatus, RefundStatus } from '@prisma/client';
import { StateMachine } from '../../common/state/state-machine';

/** KYB review: approve activates, suspend blocks new payments (refunds stay possible). */
export const merchantMachine = new StateMachine<MerchantStatus>('Merchant', {
  PENDING_REVIEW: ['ACTIVE', 'SUSPENDED'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
});

/** PENDING (row written, money not moved) -> COMPLETED (entry posted) | FAILED (nothing moved). */
export const refundMachine = new StateMachine<RefundStatus>('Refund', {
  PENDING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
});
