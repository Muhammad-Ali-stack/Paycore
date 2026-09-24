# PayCore Web

The web frontend for **PayCore**, a multi-currency (PKR / AED / USD) digital wallet. It covers the consumer app, the merchant portal (`/merchant`) and the admin console (`/admin`), with English and Urdu (RTL).

It talks to the NestJS API in [`../Backend`](../Backend) through a **Backend-for-Frontend (BFF)** built from Next.js route handlers. With `NEXT_PUBLIC_API_MOCKING=enabled` the whole app runs against an in-process, stateful mock backend, so it works with no backend at all.

The source of truth for every endpoint is [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).

---

## Quick start

Requires Node **≥ 22.12** and npm.

```bash
npm install

# Full app against the mock backend (no backend needed)
npm run dev:mock                 # http://localhost:3000

# Against a running backend (default http://localhost:3000; see .env.example)
cp .env.example .env.local       # set NEXT_PUBLIC_API_URL, remove NEXT_PUBLIC_API_MOCKING
npm run dev -- -p 3001
```

### Demo accounts (mock mode)

The login page shows these as one-tap buttons when mocking is enabled.

| Role                                                | Phone           | Password       | PIN    |
| --------------------------------------------------- | --------------- | -------------- | ------ |
| Consumer (Ayesha Khan, TIER_2, PKR/AED/USD wallets) | `+923001234567` | `Password123!` | `1234` |
| Merchant (Chai Point, settles in PKR)               | `+923009876543` | `Password123!` | `1234` |
| Admin, "maker"                                      | `+923000000001` | `Password123!` | none   |
| Admin, "checker" (approves the maker's requests)    | `+923000000002` | `Password123!` | none   |

Other seeded users you can send to or request from: `@ali_k` (+923001112233), `@sara` (+971501234567), `@bilal`, `@zainab`.

Mock behaviour you can rely on in demos:

- **OTP** is always `123456`. Registration also shows it on screen (`devOtp`).
- **Bank top-ups and withdrawals** stay `PENDING` for about 4 s, then settle. Amounts ending in **`.13`** (for example `13.13`) **fail**. The status page also has "Simulate bank outcome" buttons that call `/dev/bank/simulate`.
- **FX quotes** expire after 30 s. **Dynamic QR codes** can be paid once. **QR preview tokens** can be used once.
- **PIN**: 5 wrong attempts lock it for 15 minutes.
- **Bills**: references ending in `0000` return `BILLER_UNAVAILABLE`.
- The static QR payload for "Chai Point, Gulberg" is exported as `STATIC_QR_PAYLOAD` from `src/mocks/db.ts`. Paste it into **Scan → "paste a PayCore code"**.

---

## Scripts

| Script                          | What it does                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `dev` / `dev:mock`              | Dev server (Turbopack); `:mock` enables the mock backend                                        |
| `build` / `build:mock`          | Production build. `NEXT_PUBLIC_*` flags are **inlined at build time**                           |
| `start` / `start:mock`          | Serve the production build                                                                      |
| `typecheck`                     | `tsc --noEmit` (strict)                                                                         |
| `lint`                          | ESLint (flat config, Next + TS + Storybook + Prettier, plus design-token and no-float rules)    |
| `format` / `format:check`       | Prettier (with the Tailwind class sorter)                                                       |
| `test`                          | Vitest + React Testing Library (unit, component, BFF, mock-contract and i18n tests)             |
| `test:e2e`                      | Playwright (Chromium) against the **production build in mock mode**; starts `next start` itself |
| `gen:api`                       | Regenerates `src/lib/api/schema.d.ts` from `../Backend/openapi.json` (openapi-typescript)       |
| `storybook` / `build-storybook` | Design-system Storybook                                                                         |
| `icons`                         | Regenerates PWA PNG icons from `public/logo.svg`                                                |
| `verify`                        | Runs typecheck, lint, format:check and test                                                     |

E2E, from a clean checkout:

```bash
npx playwright install chromium
npm run build:mock
npm run test:e2e
```

---

## Architecture

### Folder structure

```
src/
  proxy.ts                  Route guard (role-based) + nonce CSP/security headers. Next 16's name for middleware.ts
  app/
    layout.tsx, providers.tsx, globals.css, manifest.ts, error.tsx, not-found.tsx
    (auth)/                 login, register, verify (OTP), forgot-password
    (app)/                  consumer: home, send, scan, receive, requests, topup, withdraw, funding/[id],
                            cards, bills, activity, analytics, profile, profile/kyc, setup-pin
    merchant/               dashboard, onboarding, qr, payments, refunds, settlements, outlets, developers
    admin/                  overview, kyc, fraud, search, approvals, merchants, audit
    api/auth/[...action]/   BFF auth: login, logout, register, verify-phone, otp/resend, password/*, session, refresh
    api/proxy/[...path]/    BFF catch-all proxy to ${API_URL}/v1/...
  components/
    ui/                     design system (shadcn-style, restyled): button, card, input/field, dialog/sheet,
                            primitives (tabs, select, switch, checkbox, segmented, tooltip, menu, avatar, progress),
                            badge/status-badge, code-input (PIN/OTP), skeleton, detail-list, copy-button, spinner
    money/                  <Amount> (the only way money is rendered), <AmountInput>
    states/                 EmptyState, ErrorState (+retry, correlation id), InlineError, QueryState, OfflineBanner
    layout/                 AppShell (sidebar on desktop, bottom tabs on mobile), AutoLock, LanguageSwitcher
    brand/                  Logo (SVG), isometric block motif
    pin-sheet.tsx           PIN confirm sheet for every money-out action
  features/                 feature components (activity, cards, charts, funding, kyc, qr, receipt, wallets,
                            merchant/*, admin/*)
  lib/
    money.ts                Integer minor-unit formatting and parsing (never floats)
    api/
      schema.d.ts           GENERATED (npm run gen:api), committed
      contracts/            Zod contracts: common, phase1, phase2, future (+ drift.ts compile-time checks)
      paths.ts              openapi-fetch path map: generated paths + future routes
      client.ts, services.ts, hooks.ts, errors.ts, idempotency.ts
    bff/                    config, backend (mock/real dispatch), session (refresh single-flight),
                            proxy-handler, auth-handler, route-guard, jwt
    forms/                  Zod form schemas (messages are i18n keys) + useFieldError
  mocks/                    MSW handlers (every endpoint: phases 1, 2 and future), stateful db + seed, ledger rules
  i18n/                     next-intl config (cookie-based locale), message loader
  hooks/                    useIdempotentAction, useCountdown, useOnline
  stores/ui.ts              Zustand: theme, hide balances, lock state (no tokens, no PII)
  styles/tokens.css         THE design tokens (the only file with raw colours)
  design/tokens.ts          Token references for TS (charts, meta theme colour, Storybook)
  stories/                  Storybook stories for the design system
messages/                   en.json, ur.json (+ .merchant/.admin catalogs per area)
e2e/                        Playwright: send-money, scan-pay, topup, a11y + RTL + route protection
public/                     logo.svg, icons/*.png (PWA), sw.js
```

### Auth and the BFF (tokens never reach JavaScript)

- The browser only calls this Next app: `/api/auth/*` and `/api/proxy/v1/*`.
- `POST /api/auth/login` calls the backend, then stores `accessToken` and `refreshToken` in **httpOnly, Secure, SameSite=Lax** cookies (`pc_at`, `pc_rt`). The response body carries only `{authenticated, role, userId, sessionId}`. An e2e test checks that tokens are not readable from `document.cookie` or `localStorage`.
- `/api/proxy/[...path]` attaches `Authorization: Bearer` server-side. It forwards `Idempotency-Key` and `x-correlation-id` (generating the id when the browser sends none), never forwards browser cookies, and responds with `cache-control: no-store`. Cross-origin mutations are rejected (Origin check, on top of SameSite=Lax).
- **Silent refresh.** The proxy refreshes _before_ sending when the access token is expired, and again on a `401 UNAUTHORIZED` (never on business 401/422s such as `PIN_INVALID`). It rotates at most once, retries the request at most once and sets the new cookies. A retried money POST is safe because the backend never ran it and it carries the same Idempotency-Key.
- **Refresh token races.** Refresh tokens are single use, and reuse revokes the session. `lib/bff/session.ts` handles this in two ways:
  1. **Single-flight:** concurrent refreshes of the same token share one backend call.
  2. **20 s grace cache:** a late request that still carries the _old_ refresh cookie gets the already-rotated pair instead of replaying the consumed token.

  Both live on `globalThis`, so they cover one server instance. On multi-instance serverless you should put a small shared lock/cache (for example Upstash Redis, keyed by a hash of the refresh token) in front of `refreshSession`. That is the only change needed; the unit tests cover both behaviours.

- **Route protection** (`src/proxy.ts` → `lib/bff/route-guard.ts`). It decodes the JWT payload for routing only; the backend enforces authorization.
  - Consumer routes need any signed-in role.
  - `/merchant` needs MERCHANT and `/admin` needs ADMIN. A wrong role goes to `/forbidden`.
  - When only the refresh cookie is left, the guard bounces through `/api/auth/refresh?next=` (same-site paths only).
  - Next 16 renamed `middleware.ts` to `proxy.ts`. Same feature, current file convention.
- **Auto-lock.** After `NEXT_PUBLIC_AUTOLOCK_MINUTES` (default 5) of inactivity, the UI locks behind a PIN (verified by the backend). After 30 more minutes it signs out.

### Mocking: why at the BFF → backend boundary

MSW handlers (`src/mocks/handlers`) implement **every** endpoint: phase 1, phase 2 and the proposed future routes.

In mock mode, `lib/bff/backend.ts` resolves the BFF's outgoing backend requests **in-process** with MSW's `getResponse()`, instead of doing a network `fetch`. Nothing above that line changes. The browser, `/api/*`, cookies, the bearer header, silent refresh, idempotency headers and correlation ids all run exactly as in production, which keeps the BFF honest. The same handlers run in Vitest, both directly and through the real proxy handler.

The mock is stateful (`src/mocks/db.ts`, on `globalThis`):

- Balances move, and quotes expire.
- Dynamic QR codes and preview tokens are single use.
- Funding goes `PENDING → SUCCEEDED/FAILED` after a delay, lazily.
- Maker-checker is enforced: a maker can't approve their own request.
- Idempotency follows the contract: a replay returns `Idempotent-Replayed: true`, a changed body gets `422 IDEMPOTENCY_KEY_REUSED`, and an in-flight request gets `409 IDEMPOTENCY_IN_PROGRESS`. Business failures are **final per key**, while PIN errors are not recorded.

Errors use the contract envelope with realistic codes (`INSUFFICIENT_FUNDS`, `LIMIT_EXCEEDED` + `details.limit`, `PIN_INVALID` + `attemptsRemaining`, `QUOTE_EXPIRED`, `CURRENCY_MISMATCH`, `QR_ALREADY_PAID`…).

A test (`src/mocks/handlers.test.ts`) parses every mock response with the Zod contracts.

> On Vercel, mock state lives per serverless instance and resets on cold start. Use mock mode there for demos only.

### Typed API layer

- `npm run gen:api` generates `src/lib/api/schema.d.ts` from `../Backend/openapi.json`. The generated types now cover **all phase 1 and phase 2 routes**: bodies, params, responses and the required `Idempotency-Key` header.
- `src/lib/api/contracts/*.ts` hold Zod schemas that validate every response at runtime. `contracts/drift.ts` is a **compile-time** check that every generated DTO is accepted by our schema and that we model every DTO field. A backend change fails `tsc` and names the DTO.
- `paths.ts` adds typed entries only for **future** routes (from `contracts/future.ts`). When the backend ships one: run `gen:api`, delete its entry in `paths.ts`, and add its DTO to `drift.ts`.
- Components never call `fetch`. They use TanStack Query hooks (`lib/api/hooks.ts`) over `lib/api/services.ts`.

### Money

`src/lib/money.ts` is the only place money becomes text.

- **Formatting** starts from `amountMinor` (string or bigint), splits major and minor parts with **BigInt**, and uses `Intl.NumberFormat.formatToParts` only for the locale's symbol, sign, grouping and digit layout. Values beyond 2^53 stay exact.
- **Parsing** user input is pure string manipulation. It accepts grouping, Urdu/Arabic digits and the Arabic decimal separator, and rejects extra decimals.
- Requests send the decimal string from `parseAmountInput(...).normalized`.
- ESLint forbids `parseFloat` in UI code.
- Charts convert to numbers for **geometry only**. Every label and tooltip goes back through `formatMinor`.

### Idempotency

- `useIdempotentAction` mints a key per logical money action when the confirm sheet opens (`crypto.randomUUID()`).
- It reuses that key for double clicks (the same in-flight promise) and for retries of network errors, 5xx and `409 IDEMPOTENCY_IN_PROGRESS` (backoff, then "Still processing…").
- It keeps the key after `PIN_INVALID`, because the backend records nothing on a PIN error.
- It rotates the key after business failures, which are final per key, so the next attempt (usually with a changed amount or recipient) is new.
- Confirm buttons are disabled while a request is in flight.
- Optimistic UI is used only for non-monetary state: card freeze, bill schedule pause, notification toggles.

### i18n and RTL

- next-intl without URL prefixes. The locale lives in the `NEXT_LOCALE` cookie, and `<html lang dir>` is set on the server, so there is no flash.
- Catalogs are split per area. `src/global.d.ts` types every key, so a missing key is a `tsc` error.
- `i18n.test.ts` checks that every `en` key exists in `ur`, that ICU placeholders match, and that the Urdu text is actually translated.
- Layout uses logical properties throughout (`ps/pe/start/end`), and directional icons flip with `rtl:`.
- Money renders as an isolated LTR run.
- Urdu UI font: Noto Naskh Arabic. Naskh is more legible than Nastaliq at UI sizes.

### Theming and design tokens

- `src/styles/tokens.css` is the **only** file with colour values. It defines dark (default) and light themes as CSS variables and is mapped into Tailwind v4's `@theme`. `--color-*: initial` removes Tailwind's default palette, so only token colours exist.
- An ESLint rule rejects hex colours in components.
- Gold is the single accent. Semantic colours are muted.
- Danger text uses `--pc-danger-text` on its tint, to keep WCAG AA.
- The theme toggle is in Profile → Preferences. It is stored in a cookie, so the server renders the right theme.

### Security

- Nonce-based CSP per request (`script-src 'self' 'nonce-…' 'strict-dynamic'`), `frame-ancestors 'none'`, `nosniff`, a strict referrer policy and a permissions policy (camera allowed for self only). HSTS and `upgrade-insecure-requests` are added on Vercel.
- No tokens in `localStorage`. Logs contain error codes and correlation ids only, never PII.
- Card PAN/CVV are revealed only after a PIN and auto-hide after the server's `hideAt` (about 30 s) or when the tab is hidden. Phone numbers, IBANs and document numbers are masked.

### PWA

- `app/manifest.ts` and the icons in `public/icons` make the app installable.
- `public/sw.js` caches only immutable build assets plus an offline page. It **never** caches `/api/*` or authenticated HTML.
- An offline banner shows whenever the browser is offline.

---

## Deploying to Vercel

1. Push the repo, then in Vercel **Add New Project** and set the **Root Directory** to `Frontend`. The Next.js framework preset and the default build/output settings work as they are.
2. Environment variables (Production and Preview):
   - `NEXT_PUBLIC_API_URL` = the public origin of the NestJS API, for example `https://api.paycore.example` (no `/v1`). Only the BFF calls it; you can set `API_URL` instead to keep it server-only.
   - `NEXT_PUBLIC_AUTOLOCK_MINUTES` = `5` (optional).
   - For a demo deployment without a backend: `NEXT_PUBLIC_API_MOCKING=enabled`. It is inlined at build time, so redeploy after changing it.
3. Deploy. The BFF sets `Secure` cookies (HTTPS on Vercel), and `proxy.ts` adds HSTS when `VERCEL` is set.
4. Backend requirements for production: the API must be reachable from Vercel's servers. CORS is not needed, because the browser never calls the API directly. It must also accept `x-correlation-id` and `Idempotency-Key` from the BFF.
5. For more than one serverless instance under load, add the shared refresh lock described under "Refresh token races".

---

## Versions and notes

| Package               | Version                   | Note                                                                                                                    |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| next                  | 16.3                      | App Router, Turbopack. `middleware.ts` → **`proxy.ts`** (Next 16 rename)                                                |
| react / react-dom     | 19.2                      | pinned by create-next-app 16.3                                                                                          |
| typescript            | **5.9**                   | TS 7.0 (native) is latest, but `typescript-eslint` needs `<6.1` and `openapi-typescript` needs `^5`                     |
| eslint                | **9**                     | `eslint-config-next` 16 plugins are validated on ESLint 9. ESLint 10 is out, but some plugins don't declare support yet |
| tailwindcss           | 4.3                       | CSS-first config: tokens in `@theme` (`globals.css`). There is no `tailwind.config.js` in v4                            |
| shadcn/ui             | CLI 4 (`components.json`) | components are hand-written in shadcn style over `radix-ui` and restyled to tokens. The CLI can add more                |
| next-intl             | 4.14                      | cookie locale, no routing middleware                                                                                    |
| @tanstack/react-query | 5                         |                                                                                                                         |
| zod                   | 4                         | with `@hookform/resolvers` 5                                                                                            |
| msw                   | 2.15                      | `getResponse()` for the in-process BFF mock                                                                             |
| recharts              | 3                         |                                                                                                                         |
| framer-motion         | 13                        | used subtly, respects `prefers-reduced-motion`                                                                          |
| vitest                | 5                         | jsdom + node environments                                                                                               |
| @playwright/test      | 1.63                      | Chromium only                                                                                                           |
| storybook             | 10.6                      | `@storybook/nextjs-vite` + `@storybook/addon-a11y`                                                                      |

If `npx playwright install chromium` times out behind a slow proxy, Playwright's own downloader has a fixed 30 s request timeout. Downloading `chrome-headless-shell-win64.zip` for the version Playwright reports, and unzipping it into `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-<rev>\`, works as well.

## Brand assets

The logo is a **placeholder**: isometric stacked blocks with slate outlines and a rising gold bar chart. Replace these files with the official artwork:

- `src/components/brand/logo.tsx`: inline SVG that uses the `--pc-logo-*` tokens, so it adapts to the theme
- `public/logo.svg`
- `public/icons/*.png` (regenerate with `npm run icons` after replacing `public/logo.svg`)
- `src/app/icon.png` (favicon)

## Proposed API for later phases

`src/lib/api/contracts/future.ts` defines REST shapes for the routes the backend doesn't have yet. `FUTURE_ENDPOINTS` at the bottom of that file is a table the backend can lift into the contract. They cover cards, bills, analytics, preferences, notifications, contacts, PIN verify, KYC document upload, PDF statements, merchant API keys, webhooks and refunds, and admin search, fraud, maker-checker and audit. They follow the contract conventions: `Money`, cursor pages, the error envelope, `Idempotency-Key` on money POSTs and `pin` in the body for money-out actions.
