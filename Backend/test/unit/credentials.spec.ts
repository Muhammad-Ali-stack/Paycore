import { validateEnv } from '../../src/config/env';
import { parseMaxmemoryPolicy } from '../../src/common/redis/redis.util';
import { requestFingerprint } from '../../src/common/idempotency/idempotency.service';
import { canonicalJson } from '../../src/common/util/crypto';
import {
  E164_PATTERN,
  PASSWORD_PATTERN,
  hashSecret,
  isWeakPin,
  verifySecret,
} from '../../src/modules/auth/credentials.policy';

describe('credentials policy', () => {
  it('rejects weak PINs', () => {
    for (const pin of ['0000', '1111', '1234', '4321', '123456', '987654', '12', 'abcd']) {
      expect(isWeakPin(pin)).toBe(true);
    }
    for (const pin of ['2580', '1357', '9082', '402913']) expect(isWeakPin(pin)).toBe(false);
  });

  it('validates phone and password formats', () => {
    expect(E164_PATTERN.test('+923001234567')).toBe(true);
    expect(E164_PATTERN.test('03001234567')).toBe(false);
    expect(PASSWORD_PATTERN.test('Password123')).toBe(true);
    expect(PASSWORD_PATTERN.test('short1')).toBe(false);
    expect(PASSWORD_PATTERN.test('nodigitshere')).toBe(false);
  });

  it('hashes with argon2id and verifies', async () => {
    const hash = await hashSecret('2580');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifySecret(hash, '2580')).toBe(true);
    expect(await verifySecret(hash, '2581')).toBe(false);
    expect(await verifySecret('not-a-hash', '2580')).toBe(false);
  });
});

describe('idempotency fingerprint', () => {
  it('is insensitive to key order and ignores the PIN', () => {
    const a = requestFingerprint('post', '/v1/transfers', { amount: '10.00', toPhone: '+923001234567', pin: '2580' });
    const b = requestFingerprint('POST', '/v1/transfers', { toPhone: '+923001234567', pin: '9999', amount: '10.00' });
    expect(a).toBe(b);
  });

  it('changes when the payload or path changes', () => {
    const base = requestFingerprint('POST', '/v1/transfers', { amount: '10.00' });
    expect(requestFingerprint('POST', '/v1/transfers', { amount: '10.01' })).not.toBe(base);
    expect(requestFingerprint('POST', '/v1/wallets/x/deposits', { amount: '10.00' })).not.toBe(base);
  });

  it('canonicalises nested objects and bigints', () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [3] } })).toBe('{"a":{"c":[3],"d":"2"},"b":1}');
  });
});

describe('env validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('applies defaults and coerces types', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.OTP_DEV_ECHO).toBe(false);
  });

  it('requires pgbouncer=true on Supabase transaction-pooler URLs', () => {
    const pooler = 'postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
    expect(() => validateEnv({ ...base, DATABASE_URL: pooler })).toThrow(/pgbouncer=true/);
    expect(validateEnv({ ...base, DATABASE_URL: `${pooler}?pgbouncer=true&connection_limit=10` }).DB_TX_ISOLATION).toBe(
      'RepeatableRead',
    );
  });

  it('requires TLS Redis in production', () => {
    // phase 2: production also requires the QR and bank-webhook secrets
    const prod = { ...base, NODE_ENV: 'production', QR_SIGNING_SECRET: 'q'.repeat(32), BANK_WEBHOOK_SECRET: 'w'.repeat(32) };
    expect(() => validateEnv(prod)).toThrow(/rediss:\/\//);
    expect(() => validateEnv({ ...prod, REDIS_URL: 'rediss://default:pw@host:12345' })).not.toThrow();
  });

  it('parses the Redis eviction policy from INFO memory', () => {
    expect(parseMaxmemoryPolicy('# Memory\r\nused_memory:1\r\nmaxmemory_policy:noeviction\r\n')).toBe('noeviction');
    expect(parseMaxmemoryPolicy('maxmemory_policy:allkeys-lru')).toBe('allkeys-lru');
    expect(parseMaxmemoryPolicy('# Memory')).toBeNull();
  });

  it('rejects short secrets and OTP echo in production', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', OTP_DEV_ECHO: 'true' })).toThrow(/OTP_DEV_ECHO/);
  });
});
