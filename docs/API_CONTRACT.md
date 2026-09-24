# PayCore API contract (shared by Backend and Frontend)

This contract is the source of truth while the backend and frontend are built in parallel.
- **Backend** implements the phase-2 routes exactly as written here. If a route has to deviate, update this file in the same change.
- **Frontend** codes against these shapes and mocks them with MSW until the backend is ready.

Routes marked **(future)** belong to later backend phases (cards, bills, fraud, analytics, admin hardening). The frontend mocks them and defines their proposed shapes in `Frontend/src/lib/api/contracts/future.ts`. The backend will adopt those shapes later.

## Conventions (all phases)

- Base URL: `${API_URL}/v1`. Health is at `/health` with no prefix. OpenAPI JSON is in `Backend/openapi.json` (regenerate with `npm run openapi:export` in `Backend/`).
- Auth: `Authorization: Bearer <accessToken>`. Tokens come from `/auth/login` and `/auth/refresh` as JSON: `{ tokenType, accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, sessionId }`. The frontend BFF stores them in httpOnly cookies. The browser never sees them.
- **Money** is always `Money = { currency: "PKR"|"AED"|"USD", amount: "1250.50", amountMinor: "125050" }`. Requests send `amount` as a decimal string in major units. Never use floats.
- **Rates** are decimal strings with 8 decimal places, for example `"277.10750000"`.
- **Idempotency:** every POST that moves money requires `Idempotency-Key` (8–128 chars `[A-Za-z0-9_.:-]`). Retrying with the same key and body replays the original response (header `Idempotent-Replayed: true`). A different body gets `422 IDEMPOTENCY_KEY_REUSED`. A request still in flight gets `409 IDEMPOTENCY_IN_PROGRESS`.
- **PIN:** money-out actions take `pin` (4–6 digits) in the body.
- **Errors:** `{ "error": { "code": string, "message": string, "details"?: object, "correlationId": string } }`. Codes are listed in `Backend/src/common/errors/domain-error.ts`. The ones the UI must handle include `INSUFFICIENT_FUNDS`, `LIMIT_EXCEEDED` (`details.limit` is `PER_TRANSACTION|DAILY|MONTHLY|MAX_BALANCE`), `CURRENCY_NOT_PERMITTED`, `PIN_INVALID` (`details.attemptsRemaining`), `PIN_LOCKED` (`details.lockedUntil`), `QUOTE_EXPIRED`, `WALLET_NOT_ACTIVE`, `ACCOUNT_LOCKED`, `RATE_LIMITED`, `VALIDATION_FAILED` (`details` is a string array), `UNAUTHORIZED`, `FORBIDDEN`.
- **Pagination:** `?cursor=<opaque>&limit=<1..100>` returns `{ items: T[], nextCursor: string | null }`.
- Timestamps are ISO-8601 UTC strings. IDs are UUIDs.
- Every response carries an `x-correlation-id` header.

## Phase 1 (implemented)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | /auth/register | `{phone, password, fullName, role?: CONSUMER\|MERCHANT}` | `{userId, otpExpiresAt, devOtp?}` |
| POST | /auth/verify-phone | `{phone, code}` | `{verified: true}` |
| POST | /auth/otp/resend | `{phone}` | `{sent, otpExpiresAt?, devOtp?}` |
| POST | /auth/login | `{phone, password, deviceId, deviceName?}` | TokenPair |
| POST | /auth/refresh | `{refreshToken}` | TokenPair (rotated, single use) |
| POST | /auth/logout | – | 204 |
| GET | /auth/sessions | – | `Session[]` `{id, deviceId, deviceName, userAgent, ipAddress, createdAt, lastUsedAt, current}` |
| DELETE | /auth/sessions/:id | – | 204 |
| POST | /auth/password/forgot · /auth/password/reset | `{phone}` · `{phone, code, newPassword}` | `{sent}` · `{reset}` |
| POST · PUT | /auth/pin | `{password, pin}` · `{currentPin, newPin}` | `{pinSet: true}` |
| GET · PATCH | /users/me | `{fullName?}` (+ `username?` in phase 2) | User `{id, phone, fullName, role, status, kycTier, phoneVerified, pinSet, createdAt}` (+ `username` in phase 2) |
| GET | /kyc/me · /kyc/tiers | – | `{tier, limits: TierLimit[], submissions}` · `TierLimit[]` |
| POST | /kyc/submissions | `{targetTier, documentType, documentNumber, documentRef?, dateOfBirth, address, businessName?}` | KycSubmission |
| POST · GET | /wallets | `{currency}` | Wallet `{id, currency, status, balance: Money, createdAt}` |
| GET | /wallets/:id/transactions | `?cursor&limit` | Page of `{postingId, transactionId, type, description, direction: IN\|OUT, currency, amount, amountMinor, balanceAfter, metadata, createdAt}` |
| POST | /wallets/:id/deposits · /withdrawals | `{amount}` · `{amount, pin}` | Transaction (synchronous sandbox rail; superseded by /funding in phase 2) |
| POST | /transfers | `{fromWalletId, toPhone, amount, pin, note?}` | Transaction (phase 2: now returns **Payment**, see below) |
| GET · POST · POST | /fx/rates · /fx/quotes · /fx/conversions | – · `{fromCurrency, toCurrency, sellAmount}` · `{quoteId, pin}` | rates table · FxQuote · `{quote, transaction}` |

`TierLimit = {tier, currency, permitted, perTransaction: Money, daily: Money, monthly: Money, maxBalance: Money}`.
`Transaction = {id, type, status, description, reversalOfId, metadata, createdAt, legs: [{walletId, direction: IN|OUT, currency, amount, amountMinor, balanceAfter}]}`.

## Phase 2 (backend builds now)

> **Backend implementation notes (phase 2 is implemented).** Everything below is implemented as written, with the additions and clarifications marked **[backend]**. Additions are extra optional/response fields or extra accepted inputs; nothing in the original shapes was removed or renamed.
> - **[backend] Status codes:** POSTs that create something return `201` (`/transfers/quotes`, `/transfers`, `/payment-requests`, `/payment-requests/:id/accept`, `/qr/receive`, `/qr/pay`, `/funding/*`, `/merchants`, `/merchant/outlets`, terminals, `/merchant/qr/dynamic`, refunds, `POST /admin/reconciliation/runs`). Action POSTs return `200`: `/qr/resolve`, `/payment-requests/:id/decline|cancel`, `/admin/merchants/:id/approve|suspend`, `/admin/settlements/run`, `/webhooks/bank`, `/dev/bank/simulate`.
> - **[backend] Failed payments are final per Idempotency-Key.** A money POST that fails for a business reason (funds, limits, QR already paid, request no longer pending...) is recorded as a `FAILED` Payment; retrying with the **same** key returns the same error (same code). Use a new key for a new attempt. A wrong PIN is checked before anything is recorded, so the same key can be retried after a PIN error.
> - **[backend] New error codes:** `USERNAME_TAKEN` 409, `CURRENCY_MISMATCH` 422, `INVALID_STATE_TRANSITION` 409, `PAYMENT_REQUEST_NOT_PENDING` 409, `PAYMENT_REQUEST_EXPIRED` 422, `QR_INVALID` 400, `QR_EXPIRED` 422, `QR_ALREADY_PAID` 409, `QR_NOT_ACTIVE` 422, `QR_PREVIEW_INVALID` 400, `QR_PREVIEW_EXPIRED` 422, `QR_PREVIEW_USED` 409, `MERCHANT_EXISTS` 409, `MERCHANT_NOT_ACTIVE` 422, `PAYMENT_NOT_REFUNDABLE` 422, `REFUND_EXCEEDS_PAYMENT` 422 (`details.refundable: Money`), `WEBHOOK_SIGNATURE_INVALID` 401, `FEATURE_DISABLED` 404, `PAYMENT_FAILED` 422 (replayed timeout failures). `LIMIT_EXCEEDED` on the recipient side carries `details.reason = "RECIPIENT_LIMIT"`.
> - **[backend] Single currency:** QR payments must be paid from a wallet in the QR currency, a merchant accepts only its `settlementCurrency`, and a payment request must be paid from a wallet in the request currency (`422 CURRENCY_MISMATCH`). Cross-currency sending is done with `/transfers/quotes`.
> - **[backend] `Payment.reference`** carries the merchant's dynamic-QR reference, the P2P/request `note`, or the refund reason.

### Users / lookup
| GET | /users/lookup?q=`+923001234567` or `@ali_k` | → `{userId, username, displayName: "Ali K.", phoneMasked: "+92300****567", wallets: Currency[]}`. 404 if not found. Never exposes the full name or phone. **[backend]** URL-encode `+` as `%2B` (a `+` that arrives decoded as a space is also accepted); `ali_k` without `@` also works; `username` is `null` if unset; rate-limited per user. |
|---|---|---|
| PATCH | /users/me | `{username}` is unique, `^[a-z0-9_]{3,20}$`, case-insensitive |

### Transfers (P2P, same- and cross-currency)
| Method | Path | Body | Response |
|---|---|---|---|
| POST | /transfers/quotes | `{fromWalletId, to: {phone?\|username?}, toCurrency, amount, amountSide: "SEND"\|"RECEIVE"}` | TransferQuote `{id, send: Money, receive: Money, fee: Money, totalDebit: Money, fx: null \| {midRate, customerRate}, recipient: {displayName, username}, expiresAt}` (same-currency quotes carry `fx: null`) |
| POST | /transfers | **either** `{quoteId, pin, note?}` **or** the phase-1 body extended with `toUsername?` | Payment |
| GET | /fees | – | `FeeRule[] {product, currency, bps, fixed: Money, min: Money, max: Money \| null}` |

### Payment requests ("request money")
| POST | /payment-requests | `{to: {phone?\|username?}, amount, currency, note?, expiresInHours?: 1..168}` | PaymentRequest |
|---|---|---|---|
| GET | /payment-requests?direction=INCOMING\|OUTGOING&status= | – | Page of PaymentRequest |
| POST | /payment-requests/:id/accept | `{fromWalletId, pin}` + Idempotency-Key | Payment |
| POST | /payment-requests/:id/decline · /cancel | – | PaymentRequest |

`PaymentRequest = {id, requester: {displayName, username}, payer: {displayName, username}, amount: Money, note, status: PENDING|ACCEPTED|DECLINED|CANCELLED|EXPIRED, expiresAt, paymentId: string|null, createdAt}`.

### Payments (unified, state machine)
`Payment = {id, type: P2P|P2P_FX|REQUEST|QR_MERCHANT|QR_P2P|REFUND, status: CREATED|PROCESSING|COMPLETED|FAILED|REVERSED|PARTIALLY_REFUNDED|REFUNDED, amount: Money, fee: Money, totalDebit: Money, received?: Money, payer: Party, payee: Party, reference: string|null, failureReason: string|null, journalEntryId: string|null, createdAt, completedAt: string|null, timeline: [{status, at, reason?}]}`.
`Party = {type: USER|MERCHANT, displayName, username?: string, merchantId?: string, outletName?: string}`.
| GET | /payments/:id | payer, payee (or merchant owner) only |
|---|---|---|

### Activity feed and statements (all wallets)
| GET | /transactions?walletId&currency&type&direction&from&to&q&cursor&limit | Page of ActivityItem `{id (posting id), paymentId, transactionId, type, title, counterparty: Party\|null, direction, amount: Money, fee: Money\|null, balanceAfter: Money, status, createdAt}` |
|---|---|---|
| GET | /transactions/statement?walletId&from&to&format=csv | `text/csv` download (PDF comes in a later phase). **[backend]** Oldest first, max 10 000 rows, columns `date,transaction_id,payment_id,type,title,counterparty,direction,currency,amount,fee,balance_after,status`. Feed `type` values: `P2P, P2P_FX, REQUEST, QR_MERCHANT, QR_P2P, REFUND, TOPUP, WITHDRAWAL, DEPOSIT, TRANSFER, FX_CONVERSION, REVERSAL`; `from` inclusive, `to` exclusive (ISO-8601); `amount` excludes the fee on OUT items, and is the net credit on top-ups. |

### QR
Payload is an opaque string `PC1.<base64url(json claims)>.<base64url(HMAC-SHA256)>`. Clients render it and send it back, and never parse it.
| Method | Path | Body | Response |
|---|---|---|---|
| POST | /qr/receive | `{currency, amount?}` | `{qrId, payload, expiresAt: string\|null}` (consumer "My QR") |
| POST | /qr/resolve | `{payload}` | QrPreview `{previewToken, kind: STATIC_MERCHANT\|DYNAMIC_MERCHANT\|P2P_RECEIVE, payee: Party, amount: Money\|null (null means the payer enters it), currency, fee: Money\|null, expiresAt: string\|null, previewExpiresAt}` |
| POST | /qr/pay | `{previewToken, fromWalletId, amount? (required when preview.amount is null), pin}` + Idempotency-Key | Payment. Dynamic QRs are single use (`409 QR_ALREADY_PAID`). Tampered payloads return `400 QR_INVALID`, expired ones `422 QR_EXPIRED`. **[backend]** A preview token is single use and bound to the user who resolved it (`409 QR_PREVIEW_USED`, `400 QR_PREVIEW_INVALID`, `422 QR_PREVIEW_EXPIRED`): resolve again to pay again. Consumer QRs with an amount are single use and expire; without an amount they are reusable (`expiresAt: null`). |

### Funding (simulated bank adapter, async webhooks)
`FundingTransaction = {id, direction: TOPUP|WITHDRAWAL, method: BANK_TRANSFER|CARD, status: PENDING|SUCCEEDED|FAILED|REVERSED, walletId, amount: Money, fee: Money, bankReference: string|null, instructions: null | {bankName, iban, accountTitle, reference}, failureReason: string|null, createdAt, updatedAt, timeline: [{status, at, reason?}]}`.
| Method | Path | Body | Response |
|---|---|---|---|
| POST | /funding/topups | `{walletId, amount, method}` + Idempotency-Key | FundingTransaction (PENDING; the wallet is credited only on SUCCEEDED) |
| POST | /funding/withdrawals | `{walletId, amount, bankAccount: {iban, accountTitle, bankName}, pin}` + Idempotency-Key | FundingTransaction (funds held immediately and released or reversed on the outcome) |
| GET | /funding/transactions · /funding/transactions/:id | `?status&cursor&limit` | Page / FundingTransaction |
| POST | /webhooks/bank | bank adapter → backend, header `X-PayCore-Signature: t=<unix>,v1=<hex hmac>` | backend only. **[backend]** HMAC-SHA256 over `<t>.<raw body>`; body `{id, type: "transaction.succeeded"\|"transaction.failed"\|"transaction.reversed", createdAt, data: {reference, amountMinor?, currency?, reason?}}` → `{received: true, duplicate, outcome: APPLIED\|DEFERRED\|FLAGGED\|IGNORED\|UNMATCHED\|DUPLICATE}` |
| POST | /dev/bank/simulate | `{fundingId, outcome: SUCCEEDED\|FAILED\|REVERSED, delayMs?}` | **non-production only**, so demos can drive outcomes. **[backend]** Deviation: `fundingId` is optional and `settlementId` is accepted instead (exactly one; SUCCEEDED → settlement `PAID`). Caller must own the funding transaction / merchant, or be ADMIN. → `{reference, outcome, eventId, delivered, scheduledFor: string\|null, receipt?: {received, duplicate, outcome}}` (with `delayMs` the webhook is delivered later by the worker: `delivered: false`). 404 when disabled. |
| GET · POST · GET | /admin/reconciliation/runs · /admin/reconciliation/runs `{date}` · /admin/reconciliation/runs/:id | | `ReconciliationRun {id, date, status, matched, missingInLedger, missingInBank, amountMismatches, items[]}`. **[backend]** `date` is `YYYY-MM-DD` UTC (default yesterday); `status: RUNNING\|COMPLETED\|FAILED`; + `createdAt, completedAt`; `items: [{type: MISSING_IN_LEDGER\|MISSING_IN_BANK\|AMOUNT_MISMATCH, bankReference, currency, bankAmount: Money\|null, ledgerAmount: Money\|null, fundingId, settlementId}]` (amounts signed: + into PayCore's bank account, - out); the list is a Page (`?cursor&limit`) |

### Merchants
| Method | Path | Body / query | Response |
|---|---|---|---|
| POST | /merchants | `{businessName, category (MCC 4 digits), registrationNumber, settlementCurrency, settlementBank: {iban, accountTitle, bankName}, website?}` (MERCHANT role) | Merchant `{id, businessName, category, status: PENDING_REVIEW\|ACTIVE\|SUSPENDED, kybTier, settlementCurrency, settlementDelayDays, mdrBps, createdAt}` |
| GET | /merchant/me · /merchant/dashboard?currency= | – | Merchant · `{today: {volume: Money, count, refunds: Money}, pendingSettlement: Money, lastSettlement: Settlement\|null, series: [{date, volume: Money, count}] (last 14 days)}` |
| GET · POST | /merchant/outlets | `{name, address?}` | Outlet `{id, name, address, status, staticQr: {qrId, payload}, createdAt}` |
| GET · POST | /merchant/outlets/:id/terminals | `{label}` | Terminal `{id, label, status, createdAt}` |
| POST | /merchant/qr/dynamic | `{amount, currency, outletId?, terminalId?, reference?, expiresInSeconds: 30..3600}` | `{qrId, payload, amount: Money, expiresAt, status: ACTIVE\|PAID\|EXPIRED}` **[backend]** + `paymentId: string\|null, reference: string\|null` |
| GET | /merchant/qr/:qrId | – | status polling for the cashier screen |
| GET | /merchant/payments?status&from&to&q&cursor&limit · /merchant/payments/:id | – | Page of Payment (plus `mdrFee: Money, net: Money, refundedAmount: Money`) |
| POST | /merchant/payments/:id/refunds | `{amount? (default full remaining), reason}` + Idempotency-Key | Refund `{id, paymentId, amount: Money, status: PENDING\|COMPLETED\|FAILED, reason, createdAt}` **[backend]** + `failureReason: string\|null` |
| GET | /merchant/settlements · /merchant/settlements/:id · /merchant/settlements/:id/report.csv | – | Settlement `{id, currency, periodStart, periodEnd, gross: Money, mdr: Money, refunds: Money, net: Money, status: PENDING\|PAID\|FAILED, paidAt, bankReference, lines?: [...]}` |
| GET · PUT | /admin/merchants?status · /admin/merchants/:id/pricing `{mdrBps, settlementDelayDays}` | | **[backend]** list is a Page of Merchant (`?status&cursor&limit`); PUT returns Merchant (`mdrBps` 0..1000, `settlementDelayDays` 0..30) |
| POST | /admin/merchants/:id/approve · /suspend | | **[backend]** Merchant (approve: `ACTIVE`, `KYB_0 → KYB_1`) |
| POST | /admin/settlements/run `{asOf?}` | | runs the T+N batch now. **[backend]** → `{asOf, settlements: Settlement[]}` (only the settlements created by this run) |
| — | /merchant/api-keys, /merchant/webhooks **(future, phase 4)** | | |

## Future phases (frontend mocks only)
Cards, bills, analytics, notification preferences, fraud cases, maker-checker approvals, admin audit log, and transaction search for admins. The frontend defines the proposed shapes in `Frontend/src/lib/api/contracts/future.ts`.
