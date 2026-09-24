/**
 * Form schemas (React Hook Form + Zod). Error messages are i18n keys under
 * `validation.*`, translated at render time by <FieldError>.
 */
import { z } from 'zod';
import { exponentOf, parseAmountInput } from '@/lib/money';
import { USERNAME_RE } from '@/lib/api/contracts/phase2';

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+\d{10,15}$/, 'phone'));

export const passwordSchema = z
  .string()
  .min(8, 'passwordLength')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'passwordMix');

export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, 'pin')
  .refine((v) => !/^(\d)\1+$/.test(v) && !'0123456789'.includes(v) && !'9876543210'.includes(v), 'pinWeak');

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'required'),
});
export type LoginForm = z.input<typeof loginSchema>;

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'required').max(120),
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    role: z.enum(['CONSUMER', 'MERCHANT']),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'passwordMatch' });
export type RegisterForm = z.input<typeof registerSchema>;

export const otpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'otp') });

export const resetSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, 'otp'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'passwordMatch' });

export const setPinSchema = z
  .object({ password: z.string().min(1, 'required'), pin: pinSchema, confirmPin: z.string() })
  .refine((v) => v.pin === v.confirmPin, { path: ['confirmPin'], message: 'pinMatch' });

export const changePinSchema = z
  .object({ currentPin: z.string().regex(/^\d{4,6}$/, 'pin'), newPin: pinSchema, confirmPin: z.string() })
  .refine((v) => v.newPin === v.confirmPin, { path: ['confirmPin'], message: 'pinMatch' });

export const usernameSchema = z.string().trim().toLowerCase().regex(USERNAME_RE, 'username');

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'required').max(120),
  username: z.union([usernameSchema, z.literal('')]),
});

/** Amount string validated against currency exponent and (optionally) a max in minor units. */
export function amountSchema(currency: string, maxMinor?: bigint) {
  return z.string().superRefine((v, ctx) => {
    const r = parseAmountInput(v, currency);
    if (!r.ok) {
      ctx.addIssue({
        code: 'custom',
        message: r.reason === 'EMPTY' ? 'required' : r.reason === 'TOO_MANY_DECIMALS' ? 'amountDecimals' : 'amount',
      });
      return;
    }
    if (r.minor <= 0n) ctx.addIssue({ code: 'custom', message: 'amountPositive' });
    else if (maxMinor !== undefined && r.minor > maxMinor) ctx.addIssue({ code: 'custom', message: 'amountTooHigh' });
  });
}

export const ibanSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, 'iban'));

export const withdrawSchema = (currency: string, maxMinor?: bigint) =>
  z.object({
    amount: amountSchema(currency, maxMinor),
    iban: ibanSchema,
    accountTitle: z.string().trim().min(2, 'required'),
    bankName: z.string().trim().min(2, 'required'),
  });

export const kycSchema = z
  .object({
    targetTier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']),
    documentType: z.enum(['CNIC', 'PASSPORT', 'EMIRATES_ID', 'DRIVING_LICENSE', 'BUSINESS_REGISTRATION']),
    documentNumber: z.string().trim().min(5, 'required').max(40),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date'),
    address: z.string().trim().min(5, 'required').max(300),
    businessName: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.documentType !== 'BUSINESS_REGISTRATION' || (v.businessName?.length ?? 0) >= 2, {
    path: ['businessName'],
    message: 'required',
  });
export type KycForm = z.input<typeof kycSchema>;

export const merchantOnboardingSchema = z.object({
  businessName: z.string().trim().min(2, 'required'),
  category: z.string().regex(/^\d{4}$/, 'required'),
  registrationNumber: z.string().trim().min(3, 'required'),
  settlementCurrency: z.enum(['PKR', 'AED', 'USD']),
  iban: ibanSchema,
  accountTitle: z.string().trim().min(2, 'required'),
  bankName: z.string().trim().min(2, 'required'),
  website: z.union([z.string().url('url'), z.literal('')]).optional(),
});

export const webhookSchema = z.object({
  url: z.string().regex(/^https:\/\/\S+$/, 'url'),
  events: z.array(z.string()).min(1, 'chooseOne'),
});

export const apiKeySchema = z.object({
  name: z.string().trim().min(2, 'required'),
  mode: z.enum(['TEST', 'LIVE']),
  scopes: z.array(z.string()).min(1, 'chooseOne'),
});

export const refundSchema = (currency: string, maxMinor: bigint) =>
  z
    .object({
      mode: z.enum(['FULL', 'PARTIAL']),
      amount: z.string(),
      reason: z.string().trim().min(3, 'required'),
    })
    .superRefine((v, ctx) => {
      if (v.mode === 'FULL') return;
      const r = parseAmountInput(v.amount, currency);
      if (!r.ok)
        ctx.addIssue({ code: 'custom', path: ['amount'], message: r.reason === 'EMPTY' ? 'required' : 'amount' });
      else if (r.minor <= 0n) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'amountPositive' });
      else if (r.minor > maxMinor) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'amountTooHigh' });
    });

export { exponentOf };
