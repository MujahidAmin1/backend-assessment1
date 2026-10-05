# Wallet & Provider Events API

A Node.js/TypeScript REST API for managing customer wallets, processing provider deposit events, maintaining immutable audit trails, and preventing duplicate crediting.

Built with **Express**, **TypeScript**, **Prisma ORM**, **SQLite**, **Zod**, and **Vitest**.

---

## Table of Contents
- [Quick Start](#quick-start)
- [Architecture & Design Decisions](#architecture--design-decisions)
- [API Reference & Examples](#api-reference--examples)
- [Running Automated Tests](#running-automated-tests)
- [Assumptions](#assumptions)
- [Time Spent](#time-spent)
- [Known Limitations](#known-limitations)
- [Next Improvements](#next-improvements)
- [Section 2: Written Explanation](#section-2-written-explanation)

---

## Quick Start

### Prerequisites
- Node.js (v18+ recommended)
- npm

### Installation & Setup

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   *(Defaults to `DATABASE_URL="file:./dev.db"` and `PORT=3000`)*

3. **Generate Prisma client & sync schema:**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Seed the database (Wallet `W001`):**
   ```bash
   npm run seed
   ```
   *(Note: The server also auto-seeds `W001` on startup if not already present).*

5. **Start development server:**
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:3000`.
   Interactive Swagger documentation is available at `http://localhost:3000/api-docs`.

---

## Architecture & Design Decisions

- **Atomicity via Database Transactions**: Both the event persistence (`Event.create`) and the wallet balance update (`Wallet.update({ balanceKobo: { increment: amount } })`) execute inside an atomic `prisma.$transaction()`. Either both commit or both roll back.
- **Traceable Event Sourcing**: Every state transition (e.g. `pending` → `successful`) creates a new `Event` record. Events are never overwritten or deleted, ensuring a tamper-evident audit log.
- **Idempotency & Deduplication**:
  - Replaying an identical `eventId` returns `200 OK` with the existing event and performs no duplicate balance changes.
  - Conflicting payloads for the same `eventId` are rejected with `409 Conflict`.
  - Multiple `eventIds` referencing the same `transactionRef` cannot credit a wallet more than once; once a transaction reaches a terminal state (`successful` or `failed`), subsequent events cannot modify or credit the balance.
  - Conflicting financial attributes (wallet, amount, currency) under the same `transactionRef` are rejected with `409 Conflict`.
- **Strict Validation**: Handled by Zod schemas validating amount (positive integer kobo), currency (`NGN` only), valid states (`pending`, `successful`, `failed`), and sanitized identifiers.
- **Shaped Aggregated GET Response**: `GET /wallets/:walletId` aggregates historical events per `transactionRef` to display the effective status and returns exact fields: `walletId`, `customerId`, `availableBalance`, `currency`, and `transactions` array (`reference`, `amount`, `currency`, `status`).

---

## API Reference & Examples

### 1. Process Provider Event
`POST /provider/events`

#### Request: Pending Event (Scenario 1)
```bash
curl -X POST http://localhost:3000/provider/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "E001",
    "transactionRef": "T001",
    "walletId": "W001",
    "amountKobo": 50000,
    "currency": "NGN",
    "status": "pending"
  }'
```
**Response (`201 Created`):**
```json
{
  "eventId": "E001",
  "transactionRef": "T001",
  "walletId": "W001",
  "amountKobo": 50000,
  "currency": "NGN",
  "status": "pending",
  "createdAt": "2026-10-05T09:30:00.000Z"
}
```

#### Request: Successful Event (Scenario 2)
```bash
curl -X POST http://localhost:3000/provider/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "E002",
    "transactionRef": "T001",
    "walletId": "W001",
    "amountKobo": 50000,
    "currency": "NGN",
    "status": "successful"
  }'
```
**Response (`201 Created`):**
```json
{
  "eventId": "E002",
  "transactionRef": "T001",
  "walletId": "W001",
  "amountKobo": 50000,
  "currency": "NGN",
  "status": "successful",
  "createdAt": "2026-10-05T09:31:00.000Z"
}
```

#### Request: Replay / Idempotency Check (Scenario 5)
Resending `E002` returns `200 OK` with the existing event record and does not credit the wallet again.

---

### 2. Get Wallet Details & Transactions
`GET /wallets/:walletId`

```bash
curl -X GET http://localhost:3000/wallets/W001
```

**Response (`200 OK`):**
```json
{
  "walletId": "W001",
  "customerId": "C001",
  "availableBalance": 50000,
  "currency": "NGN",
  "transactions": [
    {
      "reference": "T001",
      "amount": 50000,
      "currency": "NGN",
      "status": "successful"
    }
  ]
}
```

---

### 3. Create Wallet
`POST /wallets`

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "W002",
    "customerId": "C002",
    "balanceKobo": 0,
    "currency": "NGN"
  }'
```

---

## Running Automated Tests

A comprehensive integration test suite is implemented using **Vitest** and **Supertest** covering:
- All 5 required scenarios from the specification
- Terminal state immutability
- Idempotency & deduplication
- Conflicting payload & transaction reference handling
- Strict schema validation (currency, positive integer kobo, valid statuses)
- Non-existent wallet handling (404)
- Shaped wallet response aggregation

To execute the tests:
```bash
npm test
```

---

## Assumptions
1. **Currency**: All amounts are represented as non-negative integers in minor units (Kobo) for NGN (`100 kobo = 1 NGN`) to avoid floating-point inaccuracies. Only `NGN` currency is accepted as specified.
2. **Terminal States**: `successful` and `failed` are terminal states for a transaction reference. Once reached, subsequent events for that `transactionRef` cannot mutate balance or alter the terminal outcome.
3. **Transaction-Level Aggregation**: For `GET /wallets/:walletId`, multiple events referencing the same `transactionRef` (such as `pending` followed by `successful`) are presented as a single transaction entry reflecting the latest effective status.
4. **Provider Guarantees**: A provider may send duplicate events or out-of-order events; the API must remain completely deterministic and idempotent.

---

## Time Spent
- **Exploration & Code Review**: 20 minutes
- **Core Implementation & Refactoring**: 60 minutes
- **Automated Testing**: 25 minutes
- **Documentation & Section 2 Explanations**: 30 minutes
- **Total Time**: ~2 hours 15 minutes

---

## Known Limitations
1. **SQLite Database**: SQLite with WAL mode is used for simple local evaluation, but SQLite locks at the file level during writes and lacks database-level `SELECT ... FOR UPDATE` row locks needed for distributed horizontal scaling.
2. **In-Process Webhook Processing**: Webhooks are processed synchronously in the HTTP request-response cycle. Under high throughput, webhooks should be ingested to a durable queue.

---

## Next Improvements
1. **Distributed Concurrency Control with PostgreSQL & Redis**:
   - Migrate to PostgreSQL and utilize row-level pessimistic locking (`SELECT ... FOR UPDATE`) or distributed Redis locks (Redlock) on `transactionRef` to guarantee strict serializability across multiple instances.
2. **Asynchronous Webhook Ingestion & Event-Driven Architecture**:
   - Return `202 Accepted` immediately upon validating signature and enqueuing the raw payload to a reliable queue (e.g., RabbitMQ, AWS SQS, or Kafka) with idempotent consumer workers and dead-letter queues.

---

## Section 2: Written Explanation

See full detailed answers in [EXPLANATION.md](./EXPLANATION.md).

### Summary of Answers:
1. **Concurrency**: Use database-level row locking (`SELECT ... FOR UPDATE`) on the wallet/transaction reference, or unique database constraints with distributed locks (Redis Redlock), ensuring identical or concurrent requests for the same transaction serialize.
2. **Crash Recovery**: Run both event insertion and balance crediting inside an atomic ACID transaction (`prisma.$transaction`). If a crash occurs mid-flight, the transaction rolls back completely, leaving no partial state.
3. **Webhook Authentication**: Verify HMAC-SHA256 signatures passed in request headers (e.g. `X-Provider-Signature`) using a shared secret and raw request payload, paired with a timestamp header check (e.g. 5-minute threshold) to prevent replay attacks, and optional provider IP whitelisting.
4. **Balance Reconciliation**: Run an automated reconciliation worker (e.g., nightly cron job) computing `expectedBalance = sum(amountKobo)` for all `successful` events per wallet, comparing it against `wallet.balanceKobo`. Emit alerts and log discrepancies to an ops dashboard if any variance is detected.
5. **Missing Transactions**:
   - Verify provider webhook delivery logs / failure alerts.
   - Query the provider's Transaction Query API using the customer's payment reference or external bank reference.
   - If the provider confirms the deposit was successful, ingest the transaction into the reconciliation queue to credit the customer's wallet with full audit logging.
