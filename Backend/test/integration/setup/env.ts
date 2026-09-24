import { readState } from './native-postgres';

const state = readState();

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: state.databaseUrl,
  DIRECT_URL: state.databaseUrl,
  // Redis is replaced by an in-memory mock in tests (see helpers/app.ts); the URL only has to validate.
  REDIS_URL: 'redis://127.0.0.1:6399',
  JWT_ACCESS_SECRET: 'integration-test-secret-integration-test-secret',
  OTP_DEV_ECHO: 'true',
  OTP_RESEND_COOLDOWN_SECONDS: '0',
  THROTTLE_LIMIT: '100000',
  AUTH_THROTTLE_LIMIT: '100000',
  LOGIN_MAX_FAILED_ATTEMPTS: '3',
  PIN_MAX_FAILED_ATTEMPTS: '3',
  WITHDRAWAL_FEE_BPS: '10',
  TRANSFER_FEE_BPS: '0',
  FX_SPREAD_BPS: '50',
  FX_FEE_BPS: '25',
  // phase 2: no Redis/BullMQ in tests; jobs and events are driven deterministically in-process.
  QUEUE_DRIVER: 'inline',
  BANK_SIM_ENABLED: 'true',
  BANK_SIM_WEBHOOK_URL: '', // in-process delivery, whatever .env says
  QR_SIGNING_SECRET: 'integration-test-qr-signing-secret-0123456789',
  BANK_WEBHOOK_SECRET: 'integration-test-webhook-secret-0123456789',
  MERCHANT_DEFAULT_MDR_BPS: '150',
  MERCHANT_DEFAULT_SETTLEMENT_DELAY_DAYS: '1',
});
