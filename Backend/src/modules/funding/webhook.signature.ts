import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';

export const SIGNATURE_HEADER = 'x-paycore-signature';

/** HMAC-SHA256 over `${t}.${rawBody}` (hex). */
export function computeSignature(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/** Header value `t=<unix>,v1=<hex>` as the bank (or the simulator) sends it. */
export function signatureHeader(secret: string, rawBody: string | Buffer, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${computeSignature(secret, t, rawBody)}`;
}

export function parseSignatureHeader(header: string | undefined): { timestamp: number; signatures: string[] } | null {
  if (!header || header.length > 1024) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (!k || !v) continue;
    if (k === 't' && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) signatures.push(v);
  }
  return timestamp !== null && signatures.length > 0 ? { timestamp, signatures } : null;
}

/**
 * Verify a bank webhook: well-formed header, timestamp within `toleranceSeconds` of now (both
 * directions: stale replays and clock-skewed futures are rejected), and at least one v1 signature
 * matching (constant-time). Duplicate deliveries of a *valid* event are handled separately by
 * the event-id unique key.
 */
export function verifyWebhookSignature(p: {
  header: string | undefined;
  rawBody: string | Buffer;
  secret: string;
  toleranceSeconds: number;
  now?: Date;
}): { timestamp: number } {
  const parsed = parseSignatureHeader(p.header);
  if (!parsed) throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Missing or malformed X-PayCore-Signature header');
  const now = Math.floor((p.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - parsed.timestamp) > p.toleranceSeconds) {
    throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Webhook timestamp outside the allowed tolerance', { reason: 'TIMESTAMP' });
  }
  const expected = Buffer.from(computeSignature(p.secret, parsed.timestamp, p.rawBody), 'hex');
  const ok = parsed.signatures.some((s) => {
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature does not match', { reason: 'SIGNATURE' });
  return { timestamp: parsed.timestamp };
}
