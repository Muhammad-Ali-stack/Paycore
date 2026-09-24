import { QrKind } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ParsedToken, parseToken, signToken, verifySignature } from '../../common/util/signed-token';

export const QR_PREFIX = 'PC1';
export const PREVIEW_PREFIX = 'PV1';

const KIND_CODE: Record<QrKind, string> = { STATIC_MERCHANT: 'SM', DYNAMIC_MERCHANT: 'DM', P2P_RECEIVE: 'PR' };
const CODE_KIND: Record<string, QrKind> = { SM: 'STATIC_MERCHANT', DM: 'DYNAMIC_MERCHANT', PR: 'P2P_RECEIVE' };

/** Claims inside a QR payload. The DB row (by `qid`) is authoritative; the claims bind it. */
export interface QrClaims {
  v: 1;
  kid: string;
  qid: string;
  kind: QrKind;
  cur: string;
  /** minor units as a string; absent = payer enters the amount */
  amt?: string;
  /** unix seconds */
  iat: number;
  exp?: number;
}

/** Claims inside a preview token: binds the payer, payee, amount and the fee terms shown. */
export interface PreviewClaims {
  v: 1;
  kid: string;
  jti: string;
  qid: string;
  sub: string;
  kind: QrKind;
  payee: string;
  cur: string;
  amt: string | null;
  fee: { bps: number; fixed: string; min: string; max: string | null };
  iat: number;
  exp: number;
}

export interface SigningKey {
  kid: string;
  secret: string;
}

/**
 * HMAC-SHA256 signer for QR payloads (`PC1.<claims>.<sig>`) and preview tokens (`PV1.<claims>.<sig>`).
 * New tokens use the current key; verification also accepts the previous keys (rotation by kid).
 * The prefix is part of the signed input, so a preview token can never be replayed as a payload.
 */
export class QrSigner {
  private readonly keys: Map<string, string>;

  constructor(
    private readonly current: SigningKey,
    previous: SigningKey[] = [],
  ) {
    this.keys = new Map([...previous.map((k) => [k.kid, k.secret] as const), [current.kid, current.secret]]);
  }

  signPayload(input: { qid: string; kind: QrKind; currency: string; amountMinor?: bigint | null; expiresAt?: Date | null; now?: Date }): string {
    const now = input.now ?? new Date();
    const claims: Record<string, unknown> = {
      v: 1,
      kid: this.current.kid,
      qid: input.qid,
      k: KIND_CODE[input.kind],
      cur: input.currency,
      iat: Math.floor(now.getTime() / 1000),
    };
    if (input.amountMinor !== null && input.amountMinor !== undefined) claims.amt = input.amountMinor.toString();
    if (input.expiresAt) claims.exp = Math.floor(input.expiresAt.getTime() / 1000);
    return signToken(QR_PREFIX, claims, this.current.secret);
  }

  /** Verifies structure, key and signature (constant time). Expiry is checked by the caller against the DB row. */
  verifyPayload(payload: string): QrClaims {
    const parsed = parseToken(QR_PREFIX, payload);
    const claims = parsed && this.verified(parsed);
    const kind = claims ? CODE_KIND[String(claims.k)] : undefined;
    if (
      !claims ||
      !kind ||
      claims.v !== 1 ||
      typeof claims.qid !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(claims.qid) ||
      typeof claims.cur !== 'string' ||
      typeof claims.iat !== 'number' ||
      (claims.amt !== undefined && (typeof claims.amt !== 'string' || !/^[1-9]\d{0,18}$/.test(claims.amt))) ||
      (claims.exp !== undefined && typeof claims.exp !== 'number')
    ) {
      throw new DomainError('QR_INVALID', 'This QR code is not a valid PayCore code');
    }
    return {
      v: 1,
      kid: String(claims.kid),
      qid: claims.qid,
      kind,
      cur: claims.cur,
      ...(claims.amt !== undefined ? { amt: claims.amt as string } : {}),
      iat: claims.iat,
      ...(claims.exp !== undefined ? { exp: claims.exp as number } : {}),
    };
  }

  signPreview(claims: Omit<PreviewClaims, 'v' | 'kid'>): string {
    return signToken(PREVIEW_PREFIX, { v: 1, kid: this.current.kid, ...claims }, this.current.secret);
  }

  verifyPreview(token: string, now: Date = new Date()): PreviewClaims {
    const parsed = parseToken(PREVIEW_PREFIX, token);
    const claims = parsed && this.verified(parsed);
    if (!claims || claims.v !== 1 || typeof claims.jti !== 'string' || typeof claims.exp !== 'number' || typeof claims.qid !== 'string') {
      throw new DomainError('QR_PREVIEW_INVALID', 'Invalid payment preview; scan the code again');
    }
    if (claims.exp * 1000 <= now.getTime()) {
      throw new DomainError('QR_PREVIEW_EXPIRED', 'Payment preview expired; scan the code again');
    }
    return claims as unknown as PreviewClaims;
  }

  private verified(parsed: ParsedToken): Record<string, unknown> | null {
    const kid = parsed.claims.kid;
    const secret = typeof kid === 'string' ? this.keys.get(kid) : undefined;
    if (!secret) return null;
    return verifySignature(parsed, secret) ? parsed.claims : null;
  }
}
