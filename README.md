# PayCore

**Wallet-as-a-Service infrastructure for fintech teams.**

PayCore is a multi-currency (PKR / AED / USD) wallet platform delivered as an API. Companies embed wallets in their own apps and get a double-entry ledger, QR payments, transfers, virtual cards, bill payments, fraud controls, and merchant settlement without building the money layer themselves.

> **Note:** All funding rails, card networks, and billers are **simulated** behind adapter interfaces. PayCore does not move real money. In production, these adapters would connect to licensed partners (partner bank, card issuer, KYC provider).

---

## Screenshots

| Dashboard | Accounts |
|---|---|
| ![Dashboard](PayCore/Paycore%20DashBoard.PNG) | ![Accounts](PayCore/Paycore%20Accounts.PNG) |

| Cards | Settings |
|---|---|
| ![Cards](PayCore/Paycore%20Cards.PNG) | ![Settings](PayCore/Paycore%20Settings.PNG) |

---

## Features

| Area | What it does |
|---|---|
| **Ledger** | Double-entry, append-only ledger. Integer minor units only (no floats). Every entry balances per currency. Corrections happen through reversal entries. |
| **Wallets** | One wallet per user per currency, with active / frozen / closed states. |
| **Multi-currency & FX** | PKR / AED / USD conversion using time-limited quotes with spread and fees. |
| **P2P transfers** | Send and request money, with fees, limits, and PIN confirmation. |
| **QR payments** | Static and dynamic merchant QR codes with signed payloads, expiry, and replay protection. |
| **Funding** | Simulated bank top-up and withdrawal with async webhooks and reconciliation. |
| **Merchants** | Merchant accounts, QR generation, refunds, and settlement batches. |
| **Virtual cards** | Issue, freeze, and terminate cards with per-card limits and authorization / capture / reversal flows. |
| **Bill payments** | Biller catalog, inquiry, payment, and receipts. |
| **KYC tiers** | Tiered verification with per-tier limits (per transaction, daily, monthly, max balance). |
| **Fraud engine** | Rule-based risk scoring in the payment path (velocity, anomalies, device changes) returning allow / challenge / block. |
| **Idempotency** | `Idempotency-Key` support on all money-moving endpoints for safe retries. |

---

## Architecture

PayCore is a **modular monolith** built with NestJS. Modules are separated by domain and communicate through explicit interfaces and domain events.

```
Client apps ──► REST API (NestJS)
                 ├── auth / users / kyc
                 ├── wallets / ledger / fx
                 ├── transfers / qr / merchants / settlement
                 ├── funding / cards / bills
                 ├── fraud / limits
                 └── notifications / admin
                          │
              ┌───────────┴───────────┐
          PostgreSQL               Redis
        (Supabase, system        (BullMQ queues,
         of record)               rate limits, FX cache)
```

### Design decisions

- **Double-entry ledger as the source of truth.** Balances are derived from postings, with a cached balance updated in the same database transaction.
- **Concurrency safety.** Row-level locking with consistent lock ordering to prevent double-spend and deadlocks.
- **Idempotent by default.** Requests are stored with a hash of the payload so retries replay the original response.
- **Outbox pattern.** Domain events are written in the same transaction as state changes and processed by background workers.
- **Adapter interfaces.** Bank, card network, biller, and KYC providers sit behind interfaces so simulated providers can be swapped for real ones.

Further detail lives in the [`docs`](docs) folder.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS, TypeScript |
| Database | PostgreSQL (Supabase) |
| Cache / Queues | Redis, BullMQ |
| Frontend | Next.js, TypeScript, Tailwind CSS |
| Auth | JWT access tokens with rotating refresh tokens |
| Testing | Unit and integration tests, including concurrency tests |

---

## Repository Structure

```
Paycore/
├── Backend/    # NestJS API and background workers
├── Frontend/   # Web application
├── PayCore/    # Screenshots
├── docs/       # Architecture and design documentation
└── README.md
```

---

## Getting Started

No Docker required. PayCore uses hosted PostgreSQL and Redis.

### Prerequisites

- Node.js 18+
- A Supabase project (PostgreSQL)
- A hosted Redis instance (for example, Redis Cloud free tier) with the `noeviction` policy

### Backend

```bash
cd Backend
npm install
cp .env.example .env      # fill in the values below
npm run migrate
npm run seed              # optional demo data
npm run start:dev
```

### Frontend

```bash
cd Frontend
npm install
cp .env.example .env.local
npm run dev
```

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase pooled connection string (transaction mode) used by the app |
| `DIRECT_URL` | Direct connection string used for migrations |
| `REDIS_URL` | Hosted Redis connection string (`rediss://...`) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Token signing secrets |
| `NEXT_PUBLIC_API_URL` | Backend base URL (frontend) |

> Free-tier Supabase projects pause after a period of inactivity. Wake the project before running migrations or demos.

---

## Security

- Passwords hashed with argon2; transaction PIN hashed and attempt-limited
- Rate limiting and account lockout on sensitive endpoints
- Signed QR payloads and signed webhooks
- Card data tokenized and encrypted; raw PAN and CVV are never logged
- Role-based access control (consumer, merchant, admin)
- Row Level Security enabled on all tables; database reachable only through the backend

---

## Limitations

- Funding, card processing, bill payments, and KYC verification are simulated.
- No real money movement, and no regulatory licensing or compliance certification.
- FX rates are simulated or sourced from a free rates provider, not real market liquidity.

## Roadmap

- Multi-tenant developer platform (API keys, sandbox / live environments, tenant webhooks)
- Node and browser SDKs generated from the OpenAPI spec
- Real sandbox provider adapter (for example, Stripe test mode)
- Usage metering and billing per tenant

---

## Author

**Muhammad Ali**
[LinkedIn](https://www.linkedin.com/in/muhammad-ali-50159b2b1/) · [Portfolio](https://personal-portfolio-eosin-ten.vercel.app/)
