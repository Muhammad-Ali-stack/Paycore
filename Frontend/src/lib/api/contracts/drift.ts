/**
 * Compile-time contract drift check: Zod contracts vs. generated OpenAPI DTOs.
 *
 * For every endpoint the backend now types, two things must hold (checked by tsc):
 *   1. Accepts:  the generated DTO is assignable to our schema's INPUT type, so our
 *                runtime parser accepts everything the backend can send.
 *   2. Complete: every property of the DTO is modelled by our schema's OUTPUT type,
 *                so we never silently drop a field the backend added.
 *
 * After `npm run gen:api`, a failing line here names the DTO that changed.
 * This file has no runtime code.
 */
import type { z } from 'zod';
import type { components } from '../schema';
import type * as C from './common';
import type * as P1 from './phase1';
import type * as P2 from './phase2';

type G = components['schemas'];

type Accepts<S extends z.ZodType, Dto> = [Dto] extends [z.input<S>]
  ? true
  : { error: 'backend DTO not accepted by schema'; dto: Dto };
type Complete<S extends z.ZodType, Dto> = [Exclude<keyof Dto, keyof z.output<S>>] extends [never]
  ? true
  : { error: 'schema is missing DTO fields'; missing: Exclude<keyof Dto, keyof z.output<S>> };
type Check<S extends z.ZodType, Dto> = Accepts<S, Dto> extends true ? Complete<S, Dto> : Accepts<S, Dto>;

type Assert<T extends true> = T;

export type _Phase1 = [
  Assert<Check<typeof C.Money, G['MoneyDto']>>,
  Assert<Check<typeof P1.RegisterResponse, G['RegisterResponseDto']>>,
  Assert<Check<typeof P1.VerifyPhoneResponse, G['VerifyPhoneResponseDto']>>,
  Assert<Check<typeof P1.ResendOtpResponse, G['OtpSentResponseDto']>>,
  Assert<Check<typeof P1.TokenPair, G['TokenPairDto']>>,
  Assert<Check<typeof P1.Session, G['SessionDto']>>,
  Assert<Check<typeof P1.ResetResponse, G['ResetPasswordResponseDto']>>,
  Assert<Check<typeof P1.PinSetResponse, G['PinSetResponseDto']>>,
  Assert<Check<typeof P1.User, G['UserDto']>>,
  Assert<Check<typeof P1.TierLimit, G['TierLimitDto']>>,
  Assert<Check<typeof P1.KycSubmission, G['KycSubmissionDto']>>,
  Assert<Check<typeof P1.KycMe, G['KycMeDto']>>,
  Assert<Check<typeof P1.KycAuditLog, G['KycAuditLogDto']>>,
  Assert<Check<typeof P1.Wallet, G['WalletDto']>>,
  Assert<Check<typeof P1.AdminWallet, G['AdminWalletDto']>>,
  Assert<Check<typeof P1.WalletPosting, G['WalletHistoryItemDto']>>,
  Assert<Check<typeof P1.WalletPostingPage, G['WalletHistoryPageDto']>>,
  Assert<Check<typeof P1.Transaction, G['TransactionDto']>>,
  Assert<Check<typeof P1.FxRates, G['FxRatesTableDto']>>,
  Assert<Check<typeof P1.FxQuote, G['FxQuoteDto']>>,
  Assert<Check<typeof P1.FxConversion, G['ConversionResultDto']>>,
];

export type _Phase2 = [
  Assert<Check<typeof P2.UserLookup, G['UserLookupDto']>>,
  Assert<Check<typeof P2.FeeRule, G['FeeRuleDto']>>,
  Assert<Check<typeof P2.Party, G['PartyDto']>>,
  Assert<Check<typeof P2.Payment, G['PaymentDto']>>,
  Assert<Check<typeof P2.TransferQuote, G['TransferQuoteDto']>>,
  Assert<Check<typeof P2.PaymentRequest, G['PaymentRequestDto']>>,
  Assert<Check<typeof P2.PaymentRequestPage, G['PaymentRequestPageDto']>>,
  Assert<Check<typeof P2.ActivityItem, G['ActivityItemDto']>>,
  Assert<Check<typeof P2.ActivityPage, G['ActivityPageDto']>>,
  Assert<Check<typeof P2.QrReceive, G['ReceiveQrDto']>>,
  Assert<Check<typeof P2.QrPreview, G['QrPreviewDto']>>,
  Assert<Check<typeof P2.FundingTransaction, G['FundingTransactionDto']>>,
  Assert<Check<typeof P2.FundingPage, G['FundingPageDto']>>,
  Assert<Check<typeof P2.SimulationResult, G['SimulationResultDto']>>,
  Assert<Check<typeof P2.ReconciliationRun, G['ReconciliationRunDto']>>,
  Assert<Check<typeof P2.ReconciliationRunPage, G['ReconciliationRunPageDto']>>,
  Assert<Check<typeof P2.Merchant, G['MerchantDto']>>,
  Assert<Check<typeof P2.MerchantPage, G['MerchantPageDto']>>,
  Assert<Check<typeof P2.MerchantDashboard, G['MerchantDashboardDto']>>,
  Assert<Check<typeof P2.Outlet, G['OutletDto']>>,
  Assert<Check<typeof P2.Terminal, G['TerminalDto']>>,
  Assert<Check<typeof P2.DynamicQr, G['DynamicQrDto']>>,
  Assert<Check<typeof P2.MerchantPayment, G['MerchantPaymentDto']>>,
  Assert<Check<typeof P2.MerchantPaymentPage, G['MerchantPaymentPageDto']>>,
  Assert<Check<typeof P2.Refund, G['RefundDto']>>,
  Assert<Check<typeof P2.Settlement, G['SettlementDto']>>,
  Assert<Check<typeof P2.SettlementLine, G['SettlementLineDto']>>,
  Assert<Check<typeof P2.SettlementPage, G['SettlementPageDto']>>,
  Assert<Check<typeof P2.SettlementRun, G['SettlementRunDto']>>,
];
