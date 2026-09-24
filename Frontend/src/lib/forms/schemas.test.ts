// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  amountSchema,
  changePinSchema,
  kycSchema,
  loginSchema,
  merchantOnboardingSchema,
  pinSchema,
  profileSchema,
  refundSchema,
  registerSchema,
  resetSchema,
  webhookSchema,
  withdrawSchema,
} from './schemas';

const firstMessage = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  r.success ? null : { message: r.error!.issues[0]!.message, path: r.error!.issues[0]!.path.join('.') };

describe('auth schemas', () => {
  it('normalises phone numbers and rejects bad ones', () => {
    expect(loginSchema.parse({ phone: ' +92 300-1234567 ', password: 'x' }).phone).toBe('+923001234567');
    expect(firstMessage(loginSchema.safeParse({ phone: '03001234567', password: 'x' }))).toEqual({
      message: 'phone',
      path: 'phone',
    });
  });
  it('register enforces password strength and match', () => {
    const base = { fullName: 'Ali Khan', phone: '+923001112233', role: 'CONSUMER' as const };
    expect(
      firstMessage(registerSchema.safeParse({ ...base, password: 'short1', confirmPassword: 'short1' }))?.message,
    ).toBe('passwordLength');
    expect(
      firstMessage(registerSchema.safeParse({ ...base, password: 'longpassword', confirmPassword: 'longpassword' }))
        ?.message,
    ).toBe('passwordMix');
    expect(
      firstMessage(registerSchema.safeParse({ ...base, password: 'Password123', confirmPassword: 'Password124' })),
    ).toEqual({
      message: 'passwordMatch',
      path: 'confirmPassword',
    });
    expect(registerSchema.safeParse({ ...base, password: 'Password123', confirmPassword: 'Password123' }).success).toBe(
      true,
    );
  });
  it('reset requires a 6-digit OTP', () => {
    expect(
      firstMessage(resetSchema.safeParse({ code: '12345', newPassword: 'Password1', confirmPassword: 'Password1' }))
        ?.message,
    ).toBe('otp');
  });
});

describe('PIN schemas', () => {
  it('accepts 4-6 digits and rejects weak PINs', () => {
    expect(pinSchema.safeParse('4829').success).toBe(true);
    expect(pinSchema.safeParse('482913').success).toBe(true);
    expect(firstMessage(pinSchema.safeParse('123'))?.message).toBe('pin');
    expect(firstMessage(pinSchema.safeParse('1111'))?.message).toBe('pinWeak');
    expect(firstMessage(pinSchema.safeParse('1234'))?.message).toBe('pinWeak');
    expect(firstMessage(pinSchema.safeParse('9876'))?.message).toBe('pinWeak');
  });
  it('change PIN requires confirmation to match', () => {
    expect(
      firstMessage(changePinSchema.safeParse({ currentPin: '1234', newPin: '4829', confirmPin: '4828' }))?.path,
    ).toBe('confirmPin');
  });
});

describe('amount schema (no floats)', () => {
  const s = amountSchema('USD', 10_000n); // max $100.00
  it('validates format, positivity and max', () => {
    expect(s.safeParse('12.34').success).toBe(true);
    expect(firstMessage(s.safeParse(''))?.message).toBe('required');
    expect(firstMessage(s.safeParse('abc'))?.message).toBe('amount');
    expect(firstMessage(s.safeParse('1.234'))?.message).toBe('amountDecimals');
    expect(firstMessage(s.safeParse('0'))?.message).toBe('amountPositive');
    expect(firstMessage(s.safeParse('100.01'))?.message).toBe('amountTooHigh');
    expect(s.safeParse('100.00').success).toBe(true);
  });
});

describe('funding / merchant / kyc schemas', () => {
  it('withdraw normalises IBAN', () => {
    const r = withdrawSchema('PKR').parse({
      amount: '10',
      iban: 'pk36 mezn 0000 0012 3456 7890',
      accountTitle: 'Ayesha',
      bankName: 'Meezan',
    });
    expect(r.iban).toBe('PK36MEZN0000001234567890');
    expect(
      firstMessage(
        withdrawSchema('PKR').safeParse({ amount: '10', iban: '123', accountTitle: 'A B', bankName: 'Bank' }),
      )?.message,
    ).toBe('iban');
  });
  it('refund partial amount must be within the refundable remainder', () => {
    const s = refundSchema('PKR', 50_000n);
    expect(s.safeParse({ mode: 'FULL', amount: '', reason: 'Customer return' }).success).toBe(true);
    expect(firstMessage(s.safeParse({ mode: 'PARTIAL', amount: '600', reason: 'Customer return' }))).toEqual({
      message: 'amountTooHigh',
      path: 'amount',
    });
    expect(s.safeParse({ mode: 'PARTIAL', amount: '499.99', reason: 'Customer return' }).success).toBe(true);
  });
  it('merchant onboarding needs a 4-digit MCC', () => {
    const base = {
      businessName: 'Chai',
      registrationNumber: 'SECP-1',
      settlementCurrency: 'PKR' as const,
      iban: 'PK36MEZN0000001234567890',
      accountTitle: 'Chai',
      bankName: 'Meezan',
    };
    expect(merchantOnboardingSchema.safeParse({ ...base, category: '5814' }).success).toBe(true);
    expect(merchantOnboardingSchema.safeParse({ ...base, category: '58' }).success).toBe(false);
  });
  it('webhooks must be https with at least one event', () => {
    expect(
      firstMessage(webhookSchema.safeParse({ url: 'http://x.example', events: ['payment.completed'] }))?.message,
    ).toBe('url');
    expect(firstMessage(webhookSchema.safeParse({ url: 'https://x.example/hook', events: [] }))?.message).toBe(
      'chooseOne',
    );
  });
  it('kyc requires business name for business registration documents', () => {
    const base = {
      targetTier: 'TIER_2' as const,
      documentNumber: '35202-1234567-1',
      dateOfBirth: '1990-01-31',
      address: 'Gulberg, Lahore',
    };
    expect(kycSchema.safeParse({ ...base, documentType: 'CNIC' }).success).toBe(true);
    expect(firstMessage(kycSchema.safeParse({ ...base, documentType: 'BUSINESS_REGISTRATION' }))?.path).toBe(
      'businessName',
    );
    expect(
      firstMessage(kycSchema.safeParse({ ...base, documentType: 'CNIC', dateOfBirth: '31/01/1990' }))?.message,
    ).toBe('date');
  });
  it('profile username is lower-cased and validated', () => {
    expect(profileSchema.parse({ fullName: 'Ayesha Khan', username: 'Ayesha_K' }).username).toBe('ayesha_k');
    expect(profileSchema.safeParse({ fullName: 'Ayesha Khan', username: 'a!' }).success).toBe(false);
    expect(profileSchema.safeParse({ fullName: 'Ayesha Khan', username: '' }).success).toBe(true);
  });
});
