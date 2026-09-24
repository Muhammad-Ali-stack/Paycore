import { QrSigner } from '../../src/modules/qr/qr.signer';
import { b64url, parseToken, signToken, verifySignature } from '../../src/common/util/signed-token';

const K1 = { kid: 'k1', secret: 'k1-secret-value-at-least-32-characters-long' };
const K2 = { kid: 'k2', secret: 'k2-secret-value-at-least-32-characters-long' };
const QID = '6f1c1c2e-8c4a-4f51-9d2b-2a8d6c1b9e11';

const replaceClaims = (token: string, mutate: (c: Record<string, unknown>) => void) => {
  const [p, body, sig] = token.split('.') as [string, string, string];
  const claims = JSON.parse(b64url.decode(body).toString('utf8')) as Record<string, unknown>;
  mutate(claims);
  return `${p}.${b64url.encode(JSON.stringify(claims))}.${sig}`;
};

describe('QR signing (PC1 payloads)', () => {
  const signer = new QrSigner(K1);

  it('produces PC1.<base64url claims>.<base64url HMAC-SHA256> and verifies it', () => {
    const payload = signer.signPayload({ qid: QID, kind: 'DYNAMIC_MERCHANT', currency: 'PKR', amountMinor: 25000n, expiresAt: new Date('2026-09-24T12:00:00Z') });
    expect(payload).toMatch(/^PC1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(signer.verifyPayload(payload)).toMatchObject({ v: 1, kid: 'k1', qid: QID, kind: 'DYNAMIC_MERCHANT', cur: 'PKR', amt: '25000', exp: 1790251200 });
    const open = signer.signPayload({ qid: QID, kind: 'STATIC_MERCHANT', currency: 'AED' });
    const claims = signer.verifyPayload(open);
    expect(claims.amt).toBeUndefined();
    expect(claims.exp).toBeUndefined();
  });

  it('rejects any tampering with claims or signature', () => {
    const payload = signer.signPayload({ qid: QID, kind: 'DYNAMIC_MERCHANT', currency: 'PKR', amountMinor: 25000n });
    const bad = [
      replaceClaims(payload, (c) => (c.amt = '1')),
      replaceClaims(payload, (c) => (c.cur = 'USD')),
      replaceClaims(payload, (c) => (c.k = 'SM')),
      replaceClaims(payload, (c) => (c.kid = 'k2')),
      `${payload.split('.').slice(0, 2).join('.')}.${'A'.repeat(43)}`,
      payload.replace(/^PC1/, 'PV1'),
      'PC1..',
      'PC1.@@@.###',
      'garbage',
      `${payload}.extra`,
    ];
    for (const p of bad) expect(() => signer.verifyPayload(p)).toThrow(expect.objectContaining({ code: 'QR_INVALID' }));
  });

  it('rejects payloads signed with an unknown key, accepts rotated (previous) keys', () => {
    const old = new QrSigner(K2);
    const legacy = old.signPayload({ qid: QID, kind: 'P2P_RECEIVE', currency: 'PKR' });
    expect(() => signer.verifyPayload(legacy)).toThrow(expect.objectContaining({ code: 'QR_INVALID' }));
    const rotated = new QrSigner(K1, [K2]);
    expect(rotated.verifyPayload(legacy).kid).toBe('k2');
    // new codes are always signed with the current key
    expect(rotated.verifyPayload(rotated.signPayload({ qid: QID, kind: 'P2P_RECEIVE', currency: 'PKR' })).kid).toBe('k1');
  });

  it('a payload cannot be replayed as a preview token and vice versa', () => {
    const preview = signer.signPreview({
      jti: 'j1',
      qid: QID,
      sub: 'user-1',
      kind: 'STATIC_MERCHANT',
      payee: 'merchant:m1',
      cur: 'PKR',
      amt: null,
      fee: { bps: 0, fixed: '0', min: '0', max: null },
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(signer.verifyPreview(preview)).toMatchObject({ jti: 'j1', sub: 'user-1', payee: 'merchant:m1' });
    expect(() => signer.verifyPayload(preview)).toThrow(expect.objectContaining({ code: 'QR_INVALID' }));
    const payload = signer.signPayload({ qid: QID, kind: 'STATIC_MERCHANT', currency: 'PKR' });
    expect(() => signer.verifyPreview(payload)).toThrow(expect.objectContaining({ code: 'QR_PREVIEW_INVALID' }));
    expect(() => signer.verifyPreview(replaceClaims(preview, (c) => (c.sub = 'attacker')))).toThrow(expect.objectContaining({ code: 'QR_PREVIEW_INVALID' }));
  });

  it('preview tokens expire', () => {
    const preview = signer.signPreview({
      jti: 'j2',
      qid: QID,
      sub: 'u',
      kind: 'DYNAMIC_MERCHANT',
      payee: 'merchant:m',
      cur: 'PKR',
      amt: '100',
      fee: { bps: 0, fixed: '0', min: '0', max: null },
      iat: 1,
      exp: 1_000,
    });
    expect(() => signer.verifyPreview(preview)).toThrow(expect.objectContaining({ code: 'QR_PREVIEW_EXPIRED' }));
    expect(signer.verifyPreview(preview, new Date(999_000)).jti).toBe('j2');
  });

  it('generic token helpers verify in constant time and reject wrong lengths', () => {
    const t = signToken('X1', { a: 1 }, K1.secret);
    const parsed = parseToken('X1', t)!;
    expect(verifySignature(parsed, K1.secret)).toBe(true);
    expect(verifySignature(parsed, K2.secret)).toBe(false);
    expect(verifySignature({ ...parsed, signature: Buffer.alloc(8) }, K1.secret)).toBe(false);
    expect(parseToken('X1', 'X1.W10.abc')).toBeNull(); // claims must be an object
    expect(parseToken('X1', 'x'.repeat(5000))).toBeNull();
  });
});
