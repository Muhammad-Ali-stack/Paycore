import { validateEnv, parseKeyList } from '../../src/config/env';
import { DevToolsGuard } from '../../src/modules/funding/funding.module';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};
const prod = {
  ...base,
  NODE_ENV: 'production',
  REDIS_URL: 'rediss://default:pw@redis.example.com:12345',
  QR_SIGNING_SECRET: 'q'.repeat(32),
  BANK_WEBHOOK_SECRET: 'w'.repeat(32),
};

describe('phase 2 configuration', () => {
  it('has safe defaults and dev-only secret fallbacks outside production', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({ QUEUE_DRIVER: 'bullmq', BANK_SIM_ENABLED: false, QR_SIGNING_KEY_ID: 'k1', BANK_ADAPTER: 'simulated' });
    expect(env.QR_SIGNING_SECRET).toMatch(/dev-only/);
    expect(env.BANK_WEBHOOK_SECRET).toMatch(/dev-only/);
    // an empty simulator URL means in-process delivery
    expect(validateEnv({ ...base, BANK_SIM_WEBHOOK_URL: '' }).BANK_SIM_WEBHOOK_URL).toBeUndefined();
    expect(validateEnv({ ...base, BANK_SIM_WEBHOOK_URL: 'http://localhost:3000/v1/webhooks/bank' }).BANK_SIM_WEBHOOK_URL).toMatch(/^http/);
    expect(() => validateEnv({ ...base, BANK_SIM_WEBHOOK_URL: 'not a url' })).toThrow(/BANK_SIM_WEBHOOK_URL/);
  });

  it('accepts a valid production configuration', () => {
    expect(validateEnv(prod).QR_SIGNING_SECRET).toBe('q'.repeat(32));
  });

  it('makes the bank simulator impossible to enable in production', () => {
    expect(() => validateEnv({ ...prod, BANK_SIM_ENABLED: 'true' })).toThrow(/BANK_SIM_ENABLED: must be false in production/);
  });

  it('requires real QR and webhook secrets and the BullMQ driver in production', () => {
    const { QR_SIGNING_SECRET: _q, BANK_WEBHOOK_SECRET: _w, ...noSecrets } = prod;
    expect(() => validateEnv(noSecrets)).toThrow(/QR_SIGNING_SECRET: is required in production[\s\S]*BANK_WEBHOOK_SECRET: is required/);
    expect(() => validateEnv({ ...prod, QUEUE_DRIVER: 'inline' })).toThrow(/QUEUE_DRIVER/);
    expect(() => validateEnv({ ...base, QR_SIGNING_SECRET: 'short' })).toThrow(/QR_SIGNING_SECRET/);
  });

  it('parses verify-only rotation keys', () => {
    expect(parseKeyList('k0:' + 'a'.repeat(32) + ', old:' + 'b'.repeat(40))).toEqual([
      { kid: 'k0', secret: 'a'.repeat(32) },
      { kid: 'old', secret: 'b'.repeat(40) },
    ]);
    expect(() => validateEnv({ ...base, QR_SIGNING_PREVIOUS_KEYS: 'k0:short' })).toThrow(/QR_SIGNING_PREVIOUS_KEYS/);
  });

  it('the /dev route guard refuses in production or when the simulator is disabled', () => {
    const guard = (env: Record<string, unknown>, isProduction: boolean) =>
      new DevToolsGuard({ get: (k: string) => env[k], isProduction } as never);
    expect(() => guard({ BANK_SIM_ENABLED: true }, true).canActivate()).toThrow(expect.objectContaining({ code: 'FEATURE_DISABLED', status: 404 }));
    expect(() => guard({ BANK_SIM_ENABLED: false }, false).canActivate()).toThrow(expect.objectContaining({ code: 'FEATURE_DISABLED' }));
    expect(guard({ BANK_SIM_ENABLED: true }, false).canActivate()).toBe(true);
  });
});
