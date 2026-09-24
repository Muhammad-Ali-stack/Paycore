import { computeSignature, parseSignatureHeader, signatureHeader, verifyWebhookSignature } from '../../src/modules/funding/webhook.signature';

const SECRET = 'bank-webhook-secret-value-0123456789';
const BODY = '{"id":"evt_1","type":"transaction.succeeded","data":{"reference":"TOP1"}}';
const NOW = new Date('2026-09-24T12:00:00Z');
const T = Math.floor(NOW.getTime() / 1000);

describe('bank webhook signatures', () => {
  it('signs t.body with HMAC-SHA256 and verifies within the tolerance', () => {
    const header = signatureHeader(SECRET, BODY, NOW);
    expect(header).toBe(`t=${T},v1=${computeSignature(SECRET, T, BODY)}`);
    expect(verifyWebhookSignature({ header, rawBody: BODY, secret: SECRET, toleranceSeconds: 300, now: NOW })).toEqual({ timestamp: T });
    expect(verifyWebhookSignature({ header, rawBody: Buffer.from(BODY), secret: SECRET, toleranceSeconds: 300, now: new Date(NOW.getTime() + 299_000) }).timestamp).toBe(T);
  });

  it('rejects a wrong secret, a modified body and a swapped timestamp', () => {
    const header = signatureHeader(SECRET, BODY, NOW);
    const check = (h: string, body = BODY, secret = SECRET) => () =>
      verifyWebhookSignature({ header: h, rawBody: body, secret, toleranceSeconds: 300, now: NOW });
    expect(check(header, BODY, 'another-secret-another-secret-12345')).toThrow(expect.objectContaining({ code: 'WEBHOOK_SIGNATURE_INVALID', details: { reason: 'SIGNATURE' } }));
    expect(check(header, BODY.replace('TOP1', 'TOP2'))).toThrow(expect.objectContaining({ details: { reason: 'SIGNATURE' } }));
    // same signature, different (still fresh) timestamp -> the MAC covers t, so it fails
    expect(check(header.replace(`t=${T}`, `t=${T - 1}`))).toThrow(expect.objectContaining({ details: { reason: 'SIGNATURE' } }));
  });

  it('rejects stale and future timestamps (replay protection)', () => {
    for (const offset of [-301_000, 301_000, -86_400_000]) {
      const at = new Date(NOW.getTime() + offset);
      const header = signatureHeader(SECRET, BODY, at);
      expect(() => verifyWebhookSignature({ header, rawBody: BODY, secret: SECRET, toleranceSeconds: 300, now: NOW })).toThrow(
        expect.objectContaining({ details: { reason: 'TIMESTAMP' } }),
      );
    }
  });

  it('parses headers strictly and accepts any matching v1 (secret rotation)', () => {
    expect(parseSignatureHeader(undefined)).toBeNull();
    expect(parseSignatureHeader('v1=abc')).toBeNull();
    expect(parseSignatureHeader(`t=${T}`)).toBeNull();
    expect(parseSignatureHeader(`t=abc,v1=${'a'.repeat(64)}`)).toBeNull();
    expect(parseSignatureHeader(`t=${T},v1=${'A'.repeat(64)}`)).toBeNull(); // hex must be lower-case
    const good = computeSignature(SECRET, T, BODY);
    const header = `t=${T}, v1=${'0'.repeat(64)}, v1=${good}`;
    expect(parseSignatureHeader(header)?.signatures).toHaveLength(2);
    expect(verifyWebhookSignature({ header, rawBody: BODY, secret: SECRET, toleranceSeconds: 300, now: NOW }).timestamp).toBe(T);
    expect(() => verifyWebhookSignature({ header: 'nonsense', rawBody: BODY, secret: SECRET, toleranceSeconds: 300, now: NOW })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_SIGNATURE_INVALID' }),
    );
  });
});
