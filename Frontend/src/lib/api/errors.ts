import { ApiErrorBody, type ErrorCode, type LimitKind } from './contracts/common';

/** A contract-shaped API error, thrown by every API call on non-2xx. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;
  readonly correlationId: string | undefined;

  constructor(init: { status: number; code: ErrorCode; message: string; details?: unknown; correlationId?: string }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.correlationId = init.correlationId;
  }

  /** PIN_INVALID -> details.attemptsRemaining */
  get attemptsRemaining(): number | undefined {
    const d = this.details as { attemptsRemaining?: unknown } | undefined;
    return typeof d?.attemptsRemaining === 'number' ? d.attemptsRemaining : undefined;
  }

  /** PIN_LOCKED -> details.lockedUntil */
  get lockedUntil(): string | undefined {
    const d = this.details as { lockedUntil?: unknown } | undefined;
    return typeof d?.lockedUntil === 'string' ? d.lockedUntil : undefined;
  }

  /** LIMIT_EXCEEDED -> details.limit */
  get limitKind(): LimitKind | undefined {
    const d = this.details as { limit?: unknown } | undefined;
    return typeof d?.limit === 'string' ? (d.limit as LimitKind) : undefined;
  }

  /** LIMIT_EXCEEDED on the recipient side -> details.reason = "RECIPIENT_LIMIT" */
  get isRecipientLimit(): boolean {
    const d = this.details as { reason?: unknown } | undefined;
    return d?.reason === 'RECIPIENT_LIMIT';
  }

  /** VALIDATION_FAILED -> details is a string array */
  get validationMessages(): string[] {
    return Array.isArray(this.details) ? this.details.map(String) : [];
  }

  /**
   * [backend] A wrong/locked PIN is rejected before anything is recorded, so the same
   * Idempotency-Key may be reused for the corrected attempt.
   */
  get isPinError(): boolean {
    return this.code === 'PIN_INVALID' || this.code === 'PIN_LOCKED' || this.code === 'PIN_NOT_SET';
  }

  /** Worth retrying with the SAME idempotency key. */
  get retryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'IDEMPOTENCY_IN_PROGRESS' ||
      this.status === 502 ||
      this.status === 503 ||
      this.status === 504
    );
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function errorFromBody(status: number, body: unknown, headers?: Headers): ApiError {
  const parsed = ApiErrorBody.safeParse(body);
  const correlationId = headers?.get('x-correlation-id') ?? undefined;
  if (parsed.success) {
    return new ApiError({
      status,
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      details: parsed.data.error.details,
      correlationId: parsed.data.error.correlationId ?? correlationId,
    });
  }
  return new ApiError({
    status,
    code: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'INTERNAL',
    message: `Request failed with status ${status}`,
    correlationId,
  });
}

export function networkError(cause?: unknown): ApiError {
  return new ApiError({
    status: 0,
    code: 'NETWORK_ERROR',
    message: cause instanceof Error ? cause.message : 'Network request failed',
  });
}

/** i18n key for an error code (see messages/*.json "errors"). */
export function errorMessageKey(e: unknown): string {
  if (isApiError(e)) {
    const known = [
      'INSUFFICIENT_FUNDS',
      'LIMIT_EXCEEDED',
      'CURRENCY_NOT_PERMITTED',
      'PIN_INVALID',
      'PIN_LOCKED',
      'PIN_NOT_SET',
      'QUOTE_EXPIRED',
      'WALLET_NOT_ACTIVE',
      'ACCOUNT_LOCKED',
      'RATE_LIMITED',
      'VALIDATION_FAILED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'IDEMPOTENCY_IN_PROGRESS',
      'IDEMPOTENCY_KEY_REUSED',
      'QR_INVALID',
      'QR_EXPIRED',
      'QR_ALREADY_PAID',
      'INVALID_CREDENTIALS',
      'OTP_INVALID',
      'OTP_EXPIRED',
      'PHONE_NOT_VERIFIED',
      'NETWORK_ERROR',
      'CONFLICT',
      'USERNAME_TAKEN',
      'CURRENCY_MISMATCH',
      'INVALID_STATE_TRANSITION',
      'PAYMENT_REQUEST_NOT_PENDING',
      'PAYMENT_REQUEST_EXPIRED',
      'QR_NOT_ACTIVE',
      'QR_PREVIEW_INVALID',
      'QR_PREVIEW_EXPIRED',
      'QR_PREVIEW_USED',
      'MERCHANT_EXISTS',
      'MERCHANT_NOT_ACTIVE',
      'PAYMENT_NOT_REFUNDABLE',
      'REFUND_EXCEEDS_PAYMENT',
      'FEATURE_DISABLED',
      'PAYMENT_FAILED',
      'SELF_APPROVAL_FORBIDDEN',
      'APPROVAL_NOT_PENDING',
    ];
    return known.includes(e.code) ? `errors.${e.code}` : 'errors.GENERIC';
  }
  return 'errors.GENERIC';
}
