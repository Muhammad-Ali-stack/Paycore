/**
 * In-memory, stateful mock backend database.
 *
 * Lives on globalThis so every Next route bundle (and hot reloads) share one
 * instance per server process. Call resetDb() in tests.
 */
import type { Currency, Money } from '@/lib/api/contracts/common';
import type { KycSubmission, TierLimit } from '@/lib/api/contracts/phase1';
import type {
  BankAccount,
  FundingTransaction,
  Merchant,
  Party,
  Payment,
  PaymentRequest,
  ReconciliationRun,
  Settlement,
} from '@/lib/api/contracts/phase2';
import type {
  ApiKey,
  ApprovalRequest,
  AuditEvent,
  Biller,
  BillPayment,
  BillSchedule,
  Card,
  CardTransaction,
  FraudCase,
  NotificationPreferences,
  UserPreferences,
  WebhookDelivery,
  WebhookEndpoint,
} from '@/lib/api/contracts/future';
import { DAY, btoaUrl, fnv, isoAgo, isoIn, money, RATE_SCALE, uuid } from './util';

export type Role = 'CONSUMER' | 'MERCHANT' | 'ADMIN';
export type Tier = 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';

export type MockUser = {
  id: string;
  phone: string;
  password: string;
  fullName: string;
  username: string | null;
  role: Role;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  kycTier: Tier;
  phoneVerified: boolean;
  pin: string | null;
  pinAttempts: number;
  pinLockedUntil: number | null;
  failedLogins: number;
  createdAt: string;
  lastLoginAt: string | null;
  preferences: UserPreferences;
  notifications: NotificationPreferences;
};

export type MockWallet = {
  id: string;
  userId: string;
  currency: Currency;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  balance: bigint;
  createdAt: string;
};

/** One posting on one wallet: the backing row for ActivityItem. */
export type MockPosting = {
  id: string;
  walletId: string;
  paymentId: string | null;
  transactionId: string;
  type: string;
  title: string;
  counterparty: Party | null;
  direction: 'IN' | 'OUT';
  amount: bigint;
  fee: bigint;
  balanceAfter: bigint;
  status: string;
  createdAt: string;
  /** analytics only */
  category: string;
  merchantName: string | null;
};

export type MockSession = {
  id: string;
  userId: string;
  deviceId: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  refreshToken: string;
  refreshExpiresAt: number;
  /** Rotated-out refresh tokens: presenting one again is reuse -> revoke the session. */
  previousRefreshTokens: string[];
  revoked: boolean;
};

export type MockQuote = {
  id: string;
  userId: string;
  fromWalletId: string;
  toUserId: string;
  toCurrency: Currency;
  send: bigint;
  sendCurrency: Currency;
  receive: bigint;
  fee: bigint;
  midRate: bigint | null;
  customerRate: bigint | null;
  expiresAt: number;
  used: boolean;
};

export type MockFxQuote = {
  id: string;
  userId: string;
  from: Currency;
  to: Currency;
  sell: bigint;
  buy: bigint;
  fee: bigint;
  midRate: bigint;
  customerRate: bigint;
  expiresAt: number;
  used: boolean;
};

export type MockQr = {
  qrId: string;
  payload: string;
  kind: 'STATIC_MERCHANT' | 'DYNAMIC_MERCHANT' | 'P2P_RECEIVE';
  merchantId: string | null;
  outletId: string | null;
  userId: string | null;
  currency: Currency;
  amount: bigint | null;
  reference: string | null;
  expiresAt: number | null;
  status: 'ACTIVE' | 'PAID' | 'EXPIRED';
  paymentId: string | null;
};

/** QR preview tokens are single use and bound to the user who resolved them. */
export type MockPreview = { token: string; qrId: string; userId: string; expiresAt: number; used?: boolean };

export type MockFunding = FundingTransaction & {
  userId: string;
  settleAt: number;
  outcome: 'SUCCEEDED' | 'FAILED';
  amountMinor: bigint;
  feeMinor: bigint;
  bankAccount: BankAccount | null;
};

export type MockMerchant = Merchant & {
  ownerId: string;
  registrationNumber: string;
  settlementBank: BankAccount;
  website: string | null;
};

export type MockOutlet = {
  id: string;
  merchantId: string;
  name: string;
  address: string | null;
  status: string;
  staticQrId: string;
  createdAt: string;
};

export type MockTerminal = { id: string; outletId: string; label: string; status: string; createdAt: string };

export type MockMerchantPayment = {
  paymentId: string;
  merchantId: string;
  outletId: string | null;
  mdr: bigint;
  refunded: bigint;
  settlementId: string | null;
};

export type MockRefund = {
  id: string;
  paymentId: string;
  merchantId: string;
  amount: Money;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  reason: string;
  failureReason: string | null;
  createdAt: string;
};

export type Idem = {
  bodyHash: string;
  state: 'IN_PROGRESS' | 'DONE';
  status: number;
  body: unknown;
  createdAt: number;
};

export type MockDb = {
  users: MockUser[];
  wallets: MockWallet[];
  postings: MockPosting[];
  payments: Map<string, Payment>;
  sessions: MockSession[];
  otps: Map<string, { code: string; expiresAt: number; purpose: 'VERIFY' | 'RESET' }>;
  idempotency: Map<string, Idem>;
  kyc: KycSubmission[];
  quotes: Map<string, MockQuote>;
  fxQuotes: Map<string, MockFxQuote>;
  qrs: Map<string, MockQr>;
  previews: Map<string, MockPreview>;
  paymentRequests: (PaymentRequest & { requesterId: string; payerId: string })[];
  funding: MockFunding[];
  merchants: MockMerchant[];
  outlets: MockOutlet[];
  terminals: MockTerminal[];
  merchantPayments: Map<string, MockMerchantPayment>;
  refunds: MockRefund[];
  settlements: (Settlement & { merchantId: string })[];
  cards: (Card & { userId: string; pan: string; cvv: string; amountCap: bigint | null })[];
  cardTxns: CardTransaction[];
  billers: Biller[];
  billPayments: (BillPayment & { userId: string })[];
  billInquiries: Map<
    string,
    {
      userId: string;
      billerId: string;
      reference: string;
      amountDue: bigint;
      expiresAt: number;
      customerName: string;
      billingMonth: string;
      dueDate: string;
    }
  >;
  schedules: (BillSchedule & { userId: string })[];
  fraudCases: FraudCase[];
  approvals: ApprovalRequest[];
  audit: AuditEvent[];
  apiKeys: (ApiKey & { merchantId: string })[];
  webhooks: (WebhookEndpoint & { merchantId: string })[];
  deliveries: (WebhookDelivery & { webhookId: string })[];
  reconRuns: ReconciliationRun[];
  /** Deterministic ids for the demo accounts. */
  ids: {
    consumer: string;
    ali: string;
    sara: string;
    bilal: string;
    merchantUser: string;
    merchant: string;
    outlet: string;
    admin: string;
    admin2: string;
  };
};

/* --------------------------------- Rates --------------------------------- */

/** Mid rates, 8dp scaled bigints. 1 FROM = rate TO. */
const MID: Record<string, bigint> = {
  'USD/PKR': 27_850_000_000n, // 278.50
  'AED/PKR': 7_583_000_000n, // 75.83
  'USD/AED': 367_250_000n, // 3.6725
};

export function midRate(from: Currency, to: Currency): bigint {
  if (from === to) return RATE_SCALE;
  const direct = MID[`${from}/${to}`];
  if (direct) return direct;
  const inverse = MID[`${to}/${from}`];
  if (!inverse) throw new Error(`No rate ${from}/${to}`);
  return (RATE_SCALE * RATE_SCALE) / inverse;
}

/** Customer rate = mid less a 0.75% spread. */
export const FX_SPREAD_BPS = 75n;
export function customerRate(from: Currency, to: Currency): bigint {
  const mid = midRate(from, to);
  return from === to ? mid : (mid * (10000n - FX_SPREAD_BPS)) / 10000n;
}

export function convert(minor: bigint, rate8: bigint): bigint {
  return (minor * rate8) / RATE_SCALE;
}

/* ---------------------------------- Limits -------------------------------- */

const M = (major: number) => BigInt(major) * 100n;
type LimitRow = { permitted: boolean; perTx: bigint; daily: bigint; monthly: bigint; max: bigint };
const LIMITS: Record<Tier, Record<Currency, LimitRow>> = {
  TIER_0: {
    PKR: { permitted: true, perTx: M(10_000), daily: M(25_000), monthly: M(50_000), max: M(50_000) },
    AED: { permitted: false, perTx: 0n, daily: 0n, monthly: 0n, max: 0n },
    USD: { permitted: false, perTx: 0n, daily: 0n, monthly: 0n, max: 0n },
  },
  TIER_1: {
    PKR: { permitted: true, perTx: M(50_000), daily: M(100_000), monthly: M(400_000), max: M(500_000) },
    AED: { permitted: true, perTx: M(2_000), daily: M(5_000), monthly: M(20_000), max: M(25_000) },
    USD: { permitted: false, perTx: 0n, daily: 0n, monthly: 0n, max: 0n },
  },
  TIER_2: {
    PKR: { permitted: true, perTx: M(250_000), daily: M(500_000), monthly: M(2_000_000), max: M(4_000_000) },
    AED: { permitted: true, perTx: M(10_000), daily: M(20_000), monthly: M(80_000), max: M(150_000) },
    USD: { permitted: true, perTx: M(2_500), daily: M(5_000), monthly: M(20_000), max: M(40_000) },
  },
  TIER_3: {
    PKR: { permitted: true, perTx: M(1_000_000), daily: M(2_500_000), monthly: M(10_000_000), max: M(25_000_000) },
    AED: { permitted: true, perTx: M(50_000), daily: M(100_000), monthly: M(400_000), max: M(1_000_000) },
    USD: { permitted: true, perTx: M(15_000), daily: M(30_000), monthly: M(100_000), max: M(250_000) },
  },
};

export function limitRow(tier: Tier, currency: Currency) {
  return LIMITS[tier][currency];
}

export function tierLimits(tier: Tier): TierLimit[] {
  return (['PKR', 'AED', 'USD'] as const).map((c) => {
    const l = LIMITS[tier][c];
    return {
      tier,
      currency: c,
      permitted: l.permitted,
      perTransaction: money(l.perTx, c),
      daily: money(l.daily, c),
      monthly: money(l.monthly, c),
      maxBalance: money(l.max, c),
    };
  });
}

/* ------------------------------------ QR ---------------------------------- */

const QR_SECRET = 'paycore-mock-qr';
export function makeQrPayload(claims: Record<string, unknown>): string {
  const body = btoaUrl(JSON.stringify({ v: 1, ...claims }));
  const sig = btoaUrl(fnv(`${body}.${QR_SECRET}`));
  return `PC1.${body}.${sig}`;
}
export function verifyQrPayload(payload: string): { qrId: string } | null {
  const parts = payload.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'PC1') return null;
  const [, body, sig] = parts as [string, string, string];
  if (btoaUrl(fnv(`${body}.${QR_SECRET}`)) !== sig) return null;
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((body.length + 3) % 4)), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as { qid?: string };
    return json.qid ? { qrId: json.qid } : null;
  } catch {
    return null;
  }
}

/* ---------------------------------- Seed ---------------------------------- */

export const DEMO_PASSWORD = 'Password123!';
export const DEMO_PIN = '1234';
export const DEMO = {
  consumer: { phone: '+923001234567', password: DEMO_PASSWORD, pin: DEMO_PIN, name: 'Ayesha Khan' },
  merchant: { phone: '+923009876543', password: DEMO_PASSWORD, pin: DEMO_PIN, name: 'Usman Tariq' },
  admin: { phone: '+923000000001', password: DEMO_PASSWORD, name: 'Admin Operator' },
  checker: { phone: '+923000000002', password: DEMO_PASSWORD, name: 'Hina Checker' },
  /** Static QR of the seeded merchant outlet ("Chai Point, Gulberg"): payer enters the amount. */
  staticQrId: '6d2b9c1e-3f4a-4b5c-8d9e-0a1b2c3d4e5f',
};
export const STATIC_QR_PAYLOAD = makeQrPayload({ qid: DEMO.staticQrId, k: 'S' });

/** PartyDto for a user: `username` is omitted (not null) when unset, as the backend does. */
export function partyOf(u: { fullName: string; username: string | null }): Party {
  const [first, ...rest] = u.fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  return {
    type: 'USER',
    displayName: last ? `${first} ${last[0]}.` : (first ?? u.fullName),
    ...(u.username ? { username: u.username } : {}),
  };
}

const defaultPrefs = (): UserPreferences => ({ language: 'en', preferredCurrency: 'PKR', hideBalances: false });
const defaultNotifications = (): NotificationPreferences => ({
  channels: { push: true, sms: true, email: false },
  events: {
    TRANSACTIONS: true,
    REQUESTS: true,
    SECURITY: true,
    BILLS: true,
    LOW_BALANCE: false,
    PRODUCT_NEWS: false,
  },
  lowBalanceThreshold: null,
  locked: ['SECURITY'],
});

function user(p: Partial<MockUser> & Pick<MockUser, 'phone' | 'fullName' | 'role'>): MockUser {
  return {
    id: uuid(),
    password: DEMO_PASSWORD,
    username: null,
    status: 'ACTIVE',
    kycTier: 'TIER_1',
    phoneVerified: true,
    pin: DEMO_PIN,
    pinAttempts: 0,
    pinLockedUntil: null,
    failedLogins: 0,
    createdAt: isoAgo(200 * DAY),
    lastLoginAt: isoAgo(2 * DAY),
    preferences: defaultPrefs(),
    notifications: defaultNotifications(),
    ...p,
  };
}

const CATEGORIES: { category: string; merchants: string[]; range: [number, number] }[] = [
  { category: 'Groceries', merchants: ['Imtiaz Super Market', 'Carrefour', 'Al-Fatah'], range: [1500, 9000] },
  { category: 'Dining', merchants: ['Chai Point', 'Butt Karahi', 'Kababjees', 'Cosa Nostra'], range: [600, 4800] },
  { category: 'Transport', merchants: ['Careem', 'InDrive', 'PSO Fuel'], range: [350, 5200] },
  { category: 'Shopping', merchants: ['Daraz', 'Khaadi', 'Outfitters'], range: [2000, 15000] },
  { category: 'Utilities', merchants: ['LESCO', 'SNGPL', 'PTCL'], range: [2500, 12000] },
  { category: 'Entertainment', merchants: ['Cinepax', 'Netflix', 'Spotify'], range: [500, 2500] },
  { category: 'Health', merchants: ['Shaheen Chemist', 'Chughtai Lab'], range: [800, 6000] },
];

/** Deterministic PRNG so the seed is identical across restarts and test runs. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seed(): MockDb {
  const rand = rng(20260924);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] as T;

  const consumer = user({
    phone: DEMO.consumer.phone,
    fullName: DEMO.consumer.name,
    username: 'ayesha',
    role: 'CONSUMER',
    kycTier: 'TIER_2',
  });
  const ali = user({ phone: '+923001112233', fullName: 'Ali Khan', username: 'ali_k', role: 'CONSUMER' });
  const sara = user({
    phone: '+971501234567',
    fullName: 'Sara Ahmed',
    username: 'sara',
    role: 'CONSUMER',
    kycTier: 'TIER_2',
  });
  const bilal = user({
    phone: '+923334445566',
    fullName: 'Bilal Hussain',
    username: 'bilal',
    role: 'CONSUMER',
    kycTier: 'TIER_0',
  });
  const zainab = user({
    phone: '+923215556677',
    fullName: 'Zainab Raza',
    username: 'zainab',
    role: 'CONSUMER',
    kycTier: 'TIER_1',
  });
  const merchantUser = user({
    phone: DEMO.merchant.phone,
    fullName: DEMO.merchant.name,
    username: 'chaipoint',
    role: 'MERCHANT',
    kycTier: 'TIER_2',
  });
  const admin = user({ phone: DEMO.admin.phone, fullName: DEMO.admin.name, role: 'ADMIN', kycTier: 'TIER_3' });
  const admin2 = user({ phone: DEMO.checker.phone, fullName: DEMO.checker.name, role: 'ADMIN', kycTier: 'TIER_3' });
  const users = [consumer, ali, sara, bilal, zainab, merchantUser, admin, admin2];

  const w = (
    userId: string,
    currency: Currency,
    major: number,
    status: MockWallet['status'] = 'ACTIVE',
  ): MockWallet => ({
    id: uuid(),
    userId,
    currency,
    status,
    balance: M(major),
    createdAt: isoAgo(180 * DAY),
  });
  const cPKR = w(consumer.id, 'PKR', 0);
  const cAED = w(consumer.id, 'AED', 0);
  const cUSD = w(consumer.id, 'USD', 0);
  const wallets: MockWallet[] = [
    cPKR,
    cAED,
    cUSD,
    w(ali.id, 'PKR', 84_250),
    w(ali.id, 'AED', 310),
    w(sara.id, 'AED', 12_400),
    w(sara.id, 'USD', 2_150),
    w(bilal.id, 'PKR', 18_900),
    w(zainab.id, 'PKR', 42_000),
    w(zainab.id, 'AED', 120, 'FROZEN'),
    w(merchantUser.id, 'PKR', 156_300),
  ];

  /* ---- Consumer history: ~120 postings across 120 days, balances computed forward ---- */
  const postings: MockPosting[] = [];
  const payments = new Map<string, Payment>();
  const events: Omit<MockPosting, 'balanceAfter' | 'id' | 'transactionId'>[] = [];
  const counterparties = [ali, sara, bilal, zainab];
  const now = Date.now();
  for (let d = 120; d >= 0; d--) {
    const dayStart = now - d * DAY;
    if (d % 30 === 29) {
      events.push({
        walletId: cPKR.id,
        paymentId: null,
        type: 'TOPUP',
        title: 'Salary top-up · Meezan Bank',
        counterparty: null,
        direction: 'IN',
        amount: M(185_000),
        fee: 0n,
        status: 'COMPLETED',
        createdAt: new Date(dayStart + 9 * 3600_000).toISOString(),
        category: 'Income',
        merchantName: null,
      });
    }
    if (d % 45 === 10) {
      events.push({
        walletId: cUSD.id,
        paymentId: null,
        type: 'TOPUP',
        title: 'Freelance payout · Payoneer',
        counterparty: null,
        direction: 'IN',
        amount: M(600 + Math.floor(rand() * 400)),
        fee: 0n,
        status: 'COMPLETED',
        createdAt: new Date(dayStart + 11 * 3600_000).toISOString(),
        category: 'Income',
        merchantName: null,
      });
    }
    if (d % 40 === 5) {
      events.push({
        walletId: cAED.id,
        paymentId: null,
        type: 'P2P',
        title: `From ${sara.fullName}`,
        counterparty: { type: 'USER', displayName: 'Sara A.', username: 'sara' },
        direction: 'IN',
        amount: M(700 + Math.floor(rand() * 900)),
        fee: 0n,
        status: 'COMPLETED',
        createdAt: new Date(dayStart + 13 * 3600_000).toISOString(),
        category: 'Transfers',
        merchantName: null,
      });
    }
    const n = rand() < 0.35 ? 0 : rand() < 0.7 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const cat = pick(CATEGORIES);
      const merchantName = pick(cat.merchants);
      const [lo, hi] = cat.range;
      const useAed = rand() < 0.12;
      const currency: Currency = useAed ? 'AED' : 'PKR';
      const majorAmt = useAed
        ? Math.max(10, Math.round((lo + rand() * (hi - lo)) / 75))
        : Math.round(lo + rand() * (hi - lo));
      const cents = useAed ? Math.floor(rand() * 100) : 0;
      events.push({
        walletId: useAed ? cAED.id : cPKR.id,
        paymentId: null,
        type: 'QR_MERCHANT',
        title: merchantName,
        counterparty: { type: 'MERCHANT', displayName: merchantName, merchantId: uuid() },
        direction: 'OUT',
        amount: BigInt(majorAmt) * 100n + BigInt(cents),
        fee: 0n,
        status: 'COMPLETED',
        createdAt: new Date(dayStart + (12 + k * 5) * 3600_000 + Math.floor(rand() * 3000_000)).toISOString(),
        category: cat.category,
        merchantName,
      });
      void currency;
    }
    if (d % 9 === 3) {
      const cp = pick(counterparties);
      const out = rand() < 0.6;
      events.push({
        walletId: cPKR.id,
        paymentId: null,
        type: 'P2P',
        title: out ? `To ${cp.fullName}` : `From ${cp.fullName}`,
        counterparty: {
          type: 'USER',
          displayName: `${cp.fullName.split(' ')[0]} ${cp.fullName.split(' ')[1]?.[0]}.`,
          username: cp.username,
        },
        direction: out ? 'OUT' : 'IN',
        amount: M(500 + Math.floor(rand() * 9500)),
        fee: 0n,
        status: 'COMPLETED',
        createdAt: new Date(dayStart + 19 * 3600_000).toISOString(),
        category: 'Transfers',
        merchantName: null,
      });
    }
  }
  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const opening: Record<string, bigint> = { [cPKR.id]: M(60_000), [cAED.id]: M(900), [cUSD.id]: M(250) };
  const bal: Record<string, bigint> = { ...opening };
  for (const e of events) {
    const current = bal[e.walletId] ?? 0n;
    if (e.direction === 'OUT' && current < e.amount) continue; // keep history consistent
    const next = e.direction === 'IN' ? current + e.amount : current - e.amount;
    bal[e.walletId] = next;
    const paymentId = e.type === 'TOPUP' ? null : uuid();
    const posting: MockPosting = { ...e, id: uuid(), transactionId: uuid(), paymentId, balanceAfter: next };
    postings.push(posting);
    if (paymentId) {
      const wallet = wallets.find((x) => x.id === e.walletId)!;
      const amt = money(e.amount, wallet.currency);
      const me: Party = { type: 'USER', displayName: 'Ayesha K.', username: 'ayesha' };
      payments.set(paymentId, {
        id: paymentId,
        type: e.type as Payment['type'],
        status: 'COMPLETED',
        amount: amt,
        fee: money(0n, wallet.currency),
        totalDebit: amt,
        payer: e.direction === 'OUT' ? me : (e.counterparty ?? me),
        payee: e.direction === 'OUT' ? (e.counterparty ?? me) : me,
        reference: null,
        failureReason: null,
        journalEntryId: uuid(),
        createdAt: e.createdAt,
        completedAt: e.createdAt,
        timeline: [
          { status: 'CREATED', at: e.createdAt },
          { status: 'COMPLETED', at: e.createdAt },
        ],
      });
    }
  }
  cPKR.balance = bal[cPKR.id] ?? 0n;
  cAED.balance = bal[cAED.id] ?? 0n;
  cUSD.balance = bal[cUSD.id] ?? 0n;
  postings.reverse(); // newest first

  /* ---- Merchant ---- */
  const merchantId = uuid();
  const merchants: MockMerchant[] = [
    {
      id: merchantId,
      ownerId: merchantUser.id,
      businessName: 'Chai Point',
      category: '5814',
      status: 'ACTIVE',
      kybTier: 'KYB_2',
      settlementCurrency: 'PKR',
      settlementDelayDays: 1,
      mdrBps: 150,
      createdAt: isoAgo(150 * DAY),
      registrationNumber: 'SECP-0098812',
      settlementBank: {
        iban: 'PK36SCBL0000001123456702',
        accountTitle: 'Chai Point (Pvt) Ltd',
        bankName: 'Standard Chartered',
      },
      website: 'https://chaipoint.example',
    },
    {
      id: uuid(),
      ownerId: uuid(),
      businessName: 'Karachi Kites Co.',
      category: '5945',
      status: 'PENDING_REVIEW',
      kybTier: 'KYB_0',
      settlementCurrency: 'PKR',
      settlementDelayDays: 2,
      mdrBps: 200,
      createdAt: isoAgo(2 * DAY),
      registrationNumber: 'SECP-0112201',
      settlementBank: { iban: 'PK12HABB0000001234567890', accountTitle: 'Karachi Kites', bankName: 'HBL' },
      website: null,
    },
    {
      id: uuid(),
      ownerId: uuid(),
      businessName: 'Dubai Dates Trading',
      category: '5411',
      status: 'ACTIVE',
      kybTier: 'KYB_1',
      settlementCurrency: 'AED',
      settlementDelayDays: 1,
      mdrBps: 175,
      createdAt: isoAgo(60 * DAY),
      registrationNumber: 'DED-778812',
      settlementBank: {
        iban: 'AE070331234567890123456',
        accountTitle: 'Dubai Dates Trading LLC',
        bankName: 'Emirates NBD',
      },
      website: null,
    },
  ];
  const outletId = uuid();
  const qrs = new Map<string, MockQr>();
  qrs.set(DEMO.staticQrId, {
    qrId: DEMO.staticQrId,
    payload: STATIC_QR_PAYLOAD,
    kind: 'STATIC_MERCHANT',
    merchantId,
    outletId,
    userId: null,
    currency: 'PKR',
    amount: null,
    reference: null,
    expiresAt: null,
    status: 'ACTIVE',
    paymentId: null,
  });
  const outlet2Id = uuid();
  const outlet2QrId = uuid();
  qrs.set(outlet2QrId, {
    qrId: outlet2QrId,
    payload: makeQrPayload({ qid: outlet2QrId, k: 'S' }),
    kind: 'STATIC_MERCHANT',
    merchantId,
    outletId: outlet2Id,
    userId: null,
    currency: 'PKR',
    amount: null,
    reference: null,
    expiresAt: null,
    status: 'ACTIVE',
    paymentId: null,
  });
  const outlets: MockOutlet[] = [
    {
      id: outletId,
      merchantId,
      name: 'Chai Point, Gulberg',
      address: 'MM Alam Road, Lahore',
      status: 'ACTIVE',
      staticQrId: DEMO.staticQrId,
      createdAt: isoAgo(150 * DAY),
    },
    {
      id: outlet2Id,
      merchantId,
      name: 'Chai Point, DHA',
      address: 'Y Block, DHA Phase 3, Lahore',
      status: 'ACTIVE',
      staticQrId: outlet2QrId,
      createdAt: isoAgo(90 * DAY),
    },
  ];
  const terminals: MockTerminal[] = [
    { id: uuid(), outletId, label: 'Counter 1', status: 'ACTIVE', createdAt: isoAgo(140 * DAY) },
    { id: uuid(), outletId, label: 'Counter 2', status: 'ACTIVE', createdAt: isoAgo(100 * DAY) },
    { id: uuid(), outletId: outlet2Id, label: 'Main till', status: 'ACTIVE', createdAt: isoAgo(90 * DAY) },
  ];

  const merchantPayments = new Map<string, MockMerchantPayment>();
  const payerNames = ['Ali K.', 'Sara A.', 'Bilal H.', 'Zainab R.', 'Hamza M.', 'Fatima S.', 'Omar F.', 'Maryam J.'];
  const settlements: MockDb['settlements'] = [];
  const refunds: MockRefund[] = [];
  // 21 days of payments; everything older than 1 day is settled daily.
  for (let d = 20; d >= 0; d--) {
    const count = 6 + Math.floor(rand() * 10);
    let gross = 0n;
    let mdrTotal = 0n;
    const dayPayments: string[] = [];
    for (let k = 0; k < count; k++) {
      const amount = M(150 + Math.floor(rand() * 2400));
      const mdr = (amount * 150n + 5000n) / 10000n;
      const id = uuid();
      const created = new Date(now - d * DAY - Math.floor(rand() * 10 * 3600_000)).toISOString();
      const oid = rand() < 0.7 ? outletId : outlet2Id;
      payments.set(id, {
        id,
        type: 'QR_MERCHANT',
        status: 'COMPLETED',
        amount: money(amount, 'PKR'),
        fee: money(0n, 'PKR'),
        totalDebit: money(amount, 'PKR'),
        payer: { type: 'USER', displayName: pick(payerNames) },
        payee: {
          type: 'MERCHANT',
          displayName: 'Chai Point',
          merchantId,
          outletName: oid === outletId ? 'Chai Point, Gulberg' : 'Chai Point, DHA',
        },
        reference: rand() < 0.4 ? `INV-${1000 + Math.floor(rand() * 9000)}` : null,
        failureReason: null,
        journalEntryId: uuid(),
        createdAt: created,
        completedAt: created,
        timeline: [
          { status: 'CREATED', at: created },
          { status: 'COMPLETED', at: created },
        ],
      });
      merchantPayments.set(id, { paymentId: id, merchantId, outletId: oid, mdr, refunded: 0n, settlementId: null });
      gross += amount;
      mdrTotal += mdr;
      dayPayments.push(id);
    }
    // One refund every few days.
    let refundTotal = 0n;
    if (d % 4 === 2 && dayPayments[0]) {
      const p = payments.get(dayPayments[0])!;
      const mp = merchantPayments.get(p.id)!;
      const amt = BigInt(p.amount.amountMinor) / 2n;
      mp.refunded = amt;
      p.status = 'PARTIALLY_REFUNDED';
      refunds.push({
        id: uuid(),
        paymentId: p.id,
        merchantId,
        amount: money(amt, 'PKR'),
        status: 'COMPLETED',
        reason: 'Order partially cancelled',
        failureReason: null,
        createdAt: p.createdAt,
      });
      refundTotal = amt;
    }
    if (d >= 1) {
      const sid = uuid();
      const periodStart = new Date(now - d * DAY);
      periodStart.setUTCHours(0, 0, 0, 0);
      const periodEnd = new Date(periodStart.getTime() + DAY - 1);
      const lines: NonNullable<Settlement['lines']> = dayPayments.map((pid) => {
        const p = payments.get(pid)!;
        const mp = merchantPayments.get(pid)!;
        mp.settlementId = sid;
        const g = BigInt(p.amount.amountMinor);
        return {
          kind: 'PAYMENT' as const,
          paymentId: pid,
          refundId: null,
          gross: money(g, 'PKR'),
          mdr: money(mp.mdr, 'PKR'),
          net: money(g - mp.mdr, 'PKR'),
          occurredAt: p.createdAt,
        };
      });
      // Refunds settle as their own (negative) lines.
      for (const r of refunds.filter((x) => dayPayments.includes(x.paymentId))) {
        const amt = BigInt(r.amount.amountMinor);
        lines.push({
          kind: 'REFUND',
          paymentId: r.paymentId,
          refundId: r.id,
          gross: money(-amt, 'PKR'),
          mdr: money(0n, 'PKR'),
          net: money(-amt, 'PKR'),
          occurredAt: r.createdAt,
        });
      }
      settlements.push({
        id: sid,
        merchantId,
        currency: 'PKR',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        gross: money(gross, 'PKR'),
        mdr: money(mdrTotal, 'PKR'),
        refunds: money(refundTotal, 'PKR'),
        net: money(gross - mdrTotal - refundTotal, 'PKR'),
        status: d === 1 ? 'PENDING' : 'PAID',
        paidAt: d === 1 ? null : new Date(periodEnd.getTime() + DAY).toISOString(),
        bankReference: d === 1 ? null : `SCB${String(880000 + d * 37).padStart(8, '0')}`,
        lines,
      });
    }
  }
  settlements.reverse();

  /* ---- Cards ---- */
  const card = (
    label: string,
    type: 'VIRTUAL' | 'SINGLE_USE',
    walletId: string,
    currency: Currency,
    status: Card['status'],
    last4: string,
    pan: string,
  ) => ({
    id: uuid(),
    userId: consumer.id,
    walletId,
    currency,
    type,
    status,
    label,
    brand: 'VISA' as const,
    last4,
    expiryMonth: 11,
    expiryYear: 2029,
    cardholderName: 'AYESHA KHAN',
    limits: {
      perTransaction: money(currency === 'PKR' ? M(50_000) : M(500), currency),
      daily: money(currency === 'PKR' ? M(100_000) : M(1_000), currency),
      monthly: money(currency === 'PKR' ? M(300_000) : M(3_000), currency),
      ecommerce: true,
      international: currency !== 'PKR',
    },
    spentThisMonth: money(currency === 'PKR' ? M(23_480) : M(142), currency),
    createdAt: isoAgo(90 * DAY),
    pan,
    cvv: String(100 + Math.floor(rand() * 899)),
    amountCap: null as bigint | null,
  });
  const cards = [
    card('Everyday', 'VIRTUAL', cPKR.id, 'PKR', 'ACTIVE', '4821', '4000123412344821'),
    card('Subscriptions', 'VIRTUAL', cUSD.id, 'USD', 'ACTIVE', '9034', '4000567856789034'),
    card('Travel', 'VIRTUAL', cAED.id, 'AED', 'FROZEN', '1177', '4000901290121177'),
  ];
  const cardTxns: CardTransaction[] = [];
  const cardMerchants: Record<Currency, [string, string, string][]> = {
    PKR: [
      ['Daraz', '5311', 'Shopping'],
      ['Foodpanda', '5812', 'Dining'],
      ['Careem', '4121', 'Transport'],
    ],
    USD: [
      ['Netflix', '4899', 'Entertainment'],
      ['Spotify', '4899', 'Entertainment'],
      ['GitHub', '5734', 'Software'],
      ['OpenAI', '5734', 'Software'],
    ],
    AED: [
      ['Emirates', '4511', 'Travel'],
      ['Noon', '5311', 'Shopping'],
    ],
  };
  for (const c of cards) {
    for (let i = 0; i < 9; i++) {
      const [name, mcc, category] = pick(cardMerchants[c.currency]);
      const major = c.currency === 'PKR' ? 400 + Math.floor(rand() * 8000) : 5 + Math.floor(rand() * 60);
      const declined = i === 4;
      cardTxns.push({
        id: uuid(),
        cardId: c.id,
        merchantName: name,
        mcc,
        category,
        amount: money(BigInt(major) * 100n + BigInt(Math.floor(rand() * 100)), c.currency),
        originalAmount: null,
        status: declined ? 'DECLINED' : i === 0 ? 'AUTHORIZED' : 'SETTLED',
        declineReason: declined ? 'Exceeds per-transaction limit' : null,
        createdAt: isoAgo(i * 3 * DAY + Math.floor(rand() * DAY)),
      });
    }
  }

  /* ---- Billers ---- */
  const biller = (
    name: string,
    shortName: string,
    category: Biller['category'],
    referenceLabel: string,
    referencePattern: string,
    partial = false,
  ): Biller => ({
    id: uuid(),
    name,
    shortName,
    category,
    currency: 'PKR',
    referenceLabel,
    referencePattern,
    supportsInquiry: true,
    allowsPartialPayment: partial,
  });
  const billers = [
    biller('Lahore Electric Supply Co.', 'LESCO', 'ELECTRICITY', 'Reference number', '^\\d{14}$'),
    biller('K-Electric', 'KE', 'ELECTRICITY', 'Account number', '^\\d{13}$'),
    biller('Sui Northern Gas', 'SNGPL', 'GAS', 'Consumer ID', '^\\d{11}$'),
    biller('Water & Sanitation Agency', 'WASA', 'WATER', 'Consumer number', '^\\d{10}$'),
    biller('PTCL Broadband', 'PTCL', 'INTERNET', 'Account ID', '^\\d{8,10}$'),
    biller('Nayatel', 'Nayatel', 'INTERNET', 'Customer ID', '^\\d{6,8}$'),
    biller('Jazz Postpaid', 'Jazz', 'MOBILE', 'Mobile number', '^03\\d{9}$'),
    biller('Zong Postpaid', 'Zong', 'MOBILE', 'Mobile number', '^03\\d{9}$'),
    biller('Beaconhouse School System', 'Beaconhouse', 'EDUCATION', 'Challan number', '^\\d{8,12}$', true),
    biller('FBR Tax Payment (PSID)', 'FBR', 'GOVERNMENT', 'PSID', '^\\d{15,18}$'),
  ];
  const lesco = billers[0]!;
  const ptcl = billers[4]!;
  const billPayments: MockDb['billPayments'] = [0, 1, 2].map((i) => {
    const b = i === 1 ? ptcl : lesco;
    const at = isoAgo((i * 30 + 3) * DAY);
    return {
      id: uuid(),
      userId: consumer.id,
      paymentId: uuid(),
      biller: { id: b.id, name: b.name, category: b.category },
      reference: i === 1 ? '0425567788' : '04112233445566',
      customerName: 'AYESHA KHAN',
      billingMonth: new Date(Date.now() - (i + 1) * 30 * DAY).toISOString().slice(0, 7),
      amount: money(M(i === 1 ? 4_999 : 8_000 + i * 1_250), 'PKR'),
      fee: money(0n, 'PKR'),
      status: 'PAID' as const,
      receiptNumber: `RCP${780000 + i * 17}`,
      failureReason: null,
      scheduleId: null,
      createdAt: at,
      paidAt: at,
    };
  });
  const schedules: MockDb['schedules'] = [
    {
      id: uuid(),
      userId: consumer.id,
      biller: { id: ptcl.id, name: ptcl.name, category: ptcl.category },
      reference: '0425567788',
      nickname: 'Home internet',
      fromWalletId: cPKR.id,
      amountMode: 'FULL_DUE',
      fixedAmount: null,
      frequency: 'MONTHLY',
      nextRunAt: isoIn(9 * DAY),
      status: 'ACTIVE',
      lastRun: { at: isoAgo(21 * DAY), status: 'PAID', paymentId: null },
      createdAt: isoAgo(100 * DAY),
    },
  ];

  /* ---- KYC ---- */
  const kyc: KycSubmission[] = [
    {
      id: uuid(),
      userId: consumer.id,
      targetTier: 'TIER_2',
      documentType: 'CNIC',
      documentNumberLast4: '5673',
      status: 'APPROVED',
      documentRef: null,
      businessName: null,
      verificationResult: { provider: 'NADRA-sandbox', match: true },
      reviewedById: admin.id,
      rejectionReason: null,
      createdAt: isoAgo(120 * DAY),
      reviewedAt: isoAgo(119 * DAY),
    },
    ...[
      [ali, 'TIER_2', 'CNIC', '4567'],
      [bilal, 'TIER_1', 'CNIC', '4321'],
      [zainab, 'TIER_2', 'PASSPORT', '4567'],
      [sara, 'TIER_3', 'EMIRATES_ID', '5671'],
    ].map(([u, tier, doc, last4], i): KycSubmission => {
      const uu = u as MockUser;
      return {
        id: uuid(),
        userId: uu.id,
        targetTier: tier as KycSubmission['targetTier'],
        documentType: doc as KycSubmission['documentType'],
        documentNumberLast4: last4 as string,
        status: 'PENDING',
        documentRef: `kyc-docs/${uu.id}/${doc as string}-front.jpg`,
        businessName: null,
        verificationResult: null,
        reviewedById: null,
        rejectionReason: null,
        createdAt: isoAgo((i + 1) * 5 * 3600_000),
        reviewedAt: null,
        // Proposed (future) admin enrichment; the phase-1 DTO doesn't carry it.
        applicant: {
          fullName: uu.fullName,
          phoneMasked: `${uu.phone.slice(0, 6)}****${uu.phone.slice(-3)}`,
          currentTier: uu.kycTier,
        },
      };
    }),
  ];

  /* ---- Payment requests ---- */
  const pr = (
    requester: MockUser,
    payer: MockUser,
    major: number,
    currency: Currency,
    note: string,
    status: PaymentRequest['status'],
    ago: number,
  ) => ({
    id: uuid(),
    requesterId: requester.id,
    payerId: payer.id,
    requester: partyOf(requester),
    payer: partyOf(payer),
    amount: money(M(major), currency),
    note,
    status,
    expiresAt: isoIn(3 * DAY - ago),
    paymentId: null,
    createdAt: isoAgo(ago),
  });
  const paymentRequests = [
    pr(ali, consumer, 2_500, 'PKR', 'Dinner at Butt Karahi', 'PENDING', 3 * 3600_000),
    pr(sara, consumer, 45, 'AED', 'Concert tickets', 'PENDING', 20 * 3600_000),
    pr(consumer, bilal, 1_200, 'PKR', 'Cricket kit share', 'PENDING', 26 * 3600_000),
    pr(consumer, zainab, 3_000, 'PKR', 'Birthday gift split', 'ACCEPTED', 5 * DAY),
  ];

  /* ---- Funding ---- */
  const funding: MockFunding[] = [];
  const fund = (
    dir: 'TOPUP' | 'WITHDRAWAL',
    walletId: string,
    currency: Currency,
    major: number,
    status: 'SUCCEEDED' | 'FAILED',
    ago: number,
    reason: string | null = null,
  ): MockFunding => {
    const at = isoAgo(ago);
    const done = isoAgo(ago - 60_000);
    return {
      id: uuid(),
      userId: consumer.id,
      direction: dir,
      method: 'BANK_TRANSFER',
      status,
      walletId,
      amount: money(M(major), currency),
      fee: money(0n, currency),
      bankReference: status === 'SUCCEEDED' ? `MZN${Math.floor(100000 + rand() * 899999)}` : null,
      instructions: null,
      failureReason: reason,
      createdAt: at,
      updatedAt: done,
      timeline: [
        { status: 'PENDING', at },
        { status, at: done, reason },
      ],
      settleAt: 0,
      outcome: status,
      amountMinor: M(major),
      feeMinor: 0n,
      bankAccount:
        dir === 'WITHDRAWAL'
          ? { iban: 'PK36MEZN0000001234567890', accountTitle: 'Ayesha Khan', bankName: 'Meezan Bank' }
          : null,
    };
  };
  funding.push(
    fund('TOPUP', cPKR.id, 'PKR', 185_000, 'SUCCEEDED', 29 * DAY),
    fund('WITHDRAWAL', cPKR.id, 'PKR', 40_000, 'SUCCEEDED', 12 * DAY),
    fund('TOPUP', cUSD.id, 'USD', 300, 'FAILED', 8 * DAY, 'Bank declined the transfer (simulated)'),
  );

  /* ---- Admin: fraud, approvals, audit ---- */
  const adminRef = { id: admin.id, displayName: admin.fullName };
  const checkerRef = { id: admin2.id, displayName: admin2.fullName };
  const fraudCases: FraudCase[] = [
    [
      'CRITICAL',
      'OPEN',
      'VELOCITY_P2P',
      94,
      'Burst of 14 outgoing P2P transfers to new recipients in 9 minutes',
      bilal,
      M(98_000),
    ],
    [
      'HIGH',
      'INVESTIGATING',
      'NEW_DEVICE_HIGH_VALUE',
      81,
      'High-value transfer within 10 minutes of login from a new device',
      zainab,
      M(150_000),
    ],
    [
      'MEDIUM',
      'OPEN',
      'QR_TAMPER_ATTEMPTS',
      58,
      '6 rejected QR payloads (QR_INVALID) from the same session',
      ali,
      null,
    ],
    ['LOW', 'ESCALATED', 'GEO_MISMATCH', 34, 'Login from UAE, card used in Pakistan 20 minutes later', sara, M(1_200)],
    [
      'HIGH',
      'CLOSED_LEGIT',
      'STRUCTURING',
      77,
      'Nine top-ups just below the daily limit across 3 days',
      zainab,
      M(470_000),
    ],
  ].map(([severity, status, ruleCode, score, summary, u, amt], i) => {
    const uu = u as MockUser;
    return {
      id: uuid(),
      subject: {
        userId: uu.id,
        displayName: uu.fullName,
        phoneMasked: `${uu.phone.slice(0, 6)}****${uu.phone.slice(-3)}`,
      },
      severity: severity as FraudCase['severity'],
      status: status as FraudCase['status'],
      ruleCode: ruleCode as string,
      score: score as number,
      summary: summary as string,
      amount: amt === null ? null : money(amt as bigint, 'PKR'),
      relatedPaymentIds: [uuid(), uuid()],
      assignee: status === 'OPEN' ? null : adminRef,
      notes:
        status === 'OPEN'
          ? []
          : [
              {
                id: uuid(),
                author: admin.fullName,
                body: 'Contacted customer via registered phone; awaiting callback.',
                at: isoAgo((i + 1) * 3600_000),
              },
            ],
      createdAt: isoAgo((i + 1) * 7 * 3600_000),
      updatedAt: isoAgo((i + 1) * 3600_000),
    };
  });
  const zainabAed = wallets.find((x) => x.userId === zainab.id && x.currency === 'AED')!;
  const approvals: ApprovalRequest[] = [
    {
      id: uuid(),
      action: 'WALLET_UNFREEZE',
      targetType: 'WALLET',
      targetId: zainabAed.id,
      targetLabel: 'Zainab Raza · AED wallet',
      payload: { status: 'ACTIVE' },
      reason: 'Customer verified source of funds; case closed as legitimate',
      status: 'PENDING',
      maker: checkerRef,
      checker: null,
      decisionNote: null,
      createdAt: isoAgo(2 * 3600_000),
      decidedAt: null,
      expiresAt: isoIn(22 * 3600_000),
    },
    {
      id: uuid(),
      action: 'USER_SUSPEND',
      targetType: 'USER',
      targetId: bilal.id,
      targetLabel: 'Bilal Hussain',
      payload: {},
      reason: 'Velocity rule VELOCITY_P2P triggered (critical); suspend pending investigation',
      status: 'PENDING',
      maker: adminRef,
      checker: null,
      decisionNote: null,
      createdAt: isoAgo(40 * 60_000),
      decidedAt: null,
      expiresAt: isoIn(23 * 3600_000),
    },
    {
      id: uuid(),
      action: 'MERCHANT_PRICING',
      targetType: 'MERCHANT',
      targetId: merchantId,
      targetLabel: 'Chai Point',
      payload: { mdrBps: 150, settlementDelayDays: 1 },
      reason: 'Volume tier upgrade per sales agreement',
      status: 'APPROVED',
      maker: adminRef,
      checker: checkerRef,
      decisionNote: 'Agreement on file',
      createdAt: isoAgo(6 * DAY),
      decidedAt: isoAgo(6 * DAY - 3600_000),
      expiresAt: isoAgo(5 * DAY),
    },
  ];
  const auditActions = [
    ['KYC_APPROVED', 'KYC_SUBMISSION'],
    ['LOGIN', 'SESSION'],
    ['WALLET_FROZEN', 'WALLET'],
    ['APPROVAL_REQUESTED', 'APPROVAL'],
    ['MERCHANT_APPROVED', 'MERCHANT'],
    ['USER_SEARCH', 'USER'],
    ['LEDGER_INTEGRITY_CHECK', 'LEDGER'],
    ['FRAUD_CASE_ASSIGNED', 'FRAUD_CASE'],
  ];
  const audit: AuditEvent[] = Array.from({ length: 48 }, (_, i) => {
    const [action, targetType] = auditActions[i % auditActions.length]!;
    const actor = i % 3 === 0 ? admin2 : admin;
    return {
      id: uuid(),
      at: isoAgo(i * 2.5 * 3600_000),
      actor: { id: actor.id, displayName: actor.fullName, role: 'ADMIN' },
      action: action!,
      targetType: targetType!,
      targetId: uuid(),
      outcome: i % 11 === 7 ? 'DENIED' : 'SUCCESS',
      ipAddress: `10.20.${i % 7}.${30 + i}`,
      correlationId: `c-${uuid().slice(0, 8)}`,
      changes: action === 'WALLET_FROZEN' ? { before: { status: 'ACTIVE' }, after: { status: 'FROZEN' } } : null,
    };
  });

  /* ---- Merchant developers ---- */
  const apiKeys: MockDb['apiKeys'] = [
    {
      id: uuid(),
      merchantId,
      name: 'POS integration',
      prefix: 'pk_live_7Hq2',
      mode: 'LIVE',
      scopes: ['payments:read', 'qr:write'],
      createdAt: isoAgo(80 * DAY),
      lastUsedAt: isoAgo(3600_000),
      revokedAt: null,
    },
    {
      id: uuid(),
      merchantId,
      name: 'Staging',
      prefix: 'pk_test_aZ91',
      mode: 'TEST',
      scopes: ['payments:read', 'payments:write', 'refunds:write'],
      createdAt: isoAgo(40 * DAY),
      lastUsedAt: isoAgo(6 * DAY),
      revokedAt: null,
    },
  ];
  const whId = uuid();
  const webhooks: MockDb['webhooks'] = [
    {
      id: whId,
      merchantId,
      url: 'https://pos.chaipoint.example/paycore/webhooks',
      events: ['payment.completed', 'refund.completed', 'settlement.paid'],
      status: 'ENABLED',
      secretPrefix: 'whsec_3kP',
      createdAt: isoAgo(80 * DAY),
      lastDelivery: { at: isoAgo(3600_000), statusCode: 200, ok: true },
    },
  ];
  const deliveries: MockDb['deliveries'] = Array.from({ length: 12 }, (_, i) => ({
    id: uuid(),
    webhookId: whId,
    event: i % 5 === 0 ? 'settlement.paid' : 'payment.completed',
    statusCode: i === 3 ? 500 : 200,
    ok: i !== 3,
    attempt: i === 3 ? 3 : 1,
    durationMs: 80 + Math.floor(rand() * 300),
    createdAt: isoAgo(i * 3 * 3600_000 + 3600_000),
  }));

  const reconRuns: MockDb['reconRuns'] = [1, 2, 3].map((d) => {
    const at = new Date(Date.now() - (d - 1) * DAY - 2 * 3600_000).toISOString();
    return {
      id: uuid(),
      date: new Date(Date.now() - d * DAY).toISOString().slice(0, 10),
      status: 'COMPLETED' as const,
      matched: 180 + d * 13,
      missingInLedger: d === 2 ? 1 : 0,
      missingInBank: 0,
      amountMismatches: d === 3 ? 1 : 0,
      items:
        d === 2
          ? [
              {
                type: 'MISSING_IN_LEDGER' as const,
                bankReference: 'MZN771201',
                currency: 'PKR' as const,
                bankAmount: money(M(5_000), 'PKR'),
                ledgerAmount: null,
                fundingId: null,
                settlementId: null,
              },
            ]
          : d === 3
            ? [
                {
                  type: 'AMOUNT_MISMATCH' as const,
                  bankReference: 'MZN770950',
                  currency: 'PKR' as const,
                  bankAmount: money(M(12_000), 'PKR'),
                  ledgerAmount: money(M(12_500), 'PKR'),
                  fundingId: uuid(),
                  settlementId: null,
                },
              ]
            : [],
      createdAt: at,
      completedAt: at,
    };
  });

  const sessions: MockSession[] = [
    {
      id: uuid(),
      userId: consumer.id,
      deviceId: 'seed-iphone',
      deviceName: 'iPhone 15 · Safari',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      ipAddress: '39.45.12.8',
      createdAt: isoAgo(14 * DAY),
      lastUsedAt: isoAgo(5 * 3600_000),
      refreshToken: 'seed-refresh-not-usable',
      refreshExpiresAt: Date.now() + 16 * DAY,
      previousRefreshTokens: [],
      revoked: false,
    },
  ];

  return {
    users,
    wallets,
    postings,
    payments,
    sessions,
    otps: new Map(),
    idempotency: new Map(),
    kyc,
    quotes: new Map(),
    fxQuotes: new Map(),
    qrs,
    previews: new Map(),
    paymentRequests,
    funding,
    merchants,
    outlets,
    terminals,
    merchantPayments,
    refunds,
    settlements,
    cards,
    cardTxns,
    billers,
    billPayments,
    billInquiries: new Map(),
    schedules,
    fraudCases,
    approvals,
    audit,
    apiKeys,
    webhooks,
    deliveries,
    reconRuns,
    ids: {
      consumer: consumer.id,
      ali: ali.id,
      sara: sara.id,
      bilal: bilal.id,
      merchantUser: merchantUser.id,
      merchant: merchantId,
      outlet: outletId,
      admin: admin.id,
      admin2: admin2.id,
    },
  };
}

const g = globalThis as typeof globalThis & { __paycoreMockDb?: MockDb };

export function db(): MockDb {
  if (!g.__paycoreMockDb) g.__paycoreMockDb = seed();
  return g.__paycoreMockDb;
}

export function resetDb() {
  g.__paycoreMockDb = seed();
  return g.__paycoreMockDb;
}

/** Funding settle delay (ms). Tests may shorten it via MOCK_FUNDING_DELAY_MS. */
export function fundingDelayMs(): number {
  const v = Number(process.env.MOCK_FUNDING_DELAY_MS ?? process.env.NEXT_PUBLIC_MOCK_FUNDING_DELAY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 4000;
}
