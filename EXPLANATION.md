# Section 2: Written Explanation

This document addresses the five core architectural, reliability, and security questions outlined in the assessment.

---

### 1. Concurrency: Preventing Duplicate Credits

**Problem:** Two identical or overlapping requests (e.g. two concurrent `POST /provider/events` calls for the same `transactionRef` or `eventId`) arrive simultaneously across multiple API nodes, leading to potential race conditions where both threads read a pre-credit balance and both increment it.

**Solution:**
1. **Database Row Locks (`SELECT ... FOR UPDATE`):**
   In a production SQL database (such as PostgreSQL), all event processing executes within a transaction that acquires a row-level lock on the target wallet or transaction record (`SELECT * FROM "Wallet" WHERE id = $1 FOR UPDATE`). Any concurrent request attempting to access the same wallet must wait until the active transaction commits or aborts.
2. **Database Unique Constraints & Deduplication Table:**
   Rely on ACID-compliant database constraints as the final safety net. A unique composite index or an idempotency log table (e.g., `UNIQUE(eventId)` and a single-credit status ledger on `transactionRef`) causes any second concurrent insert to immediately fail with a unique constraint error (`23505` in Postgres, `P2002` in Prisma), triggering a clean rollback.
3. **Distributed Locks (Redis / Redlock):**
   At the application gateway/worker layer, acquire a short-lived distributed mutex on the transaction key (`lock:txn:<transactionRef>`, TTL: 5–10s) before entering the business logic. If the lock is held, the second request either polls briefly or is rejected safely.

---

### 2. Crash Recovery: Database Failure Mid-Transaction

**Problem:** The database or server crashes after an event is recorded in the table, but before the corresponding wallet balance is updated.

**Behavior & Guarantee:**
1. **ACID Transaction Atomicity:**
   In our implementation, both the `Event.create()` and `Wallet.update({ balanceKobo: { increment: amount } })` operations are executed within an atomic database transaction (`prisma.$transaction(async (tx) => { ... })`).
2. **Crash Scenario Outcome:**
   - If the system, network, or database crashes prior to transaction commit, the database engine's Write-Ahead Log (WAL) or transaction journal recognizes the transaction as uncommitted upon recovery and automatically rolls back all intermediate writes.
   - Neither the event nor the balance update will persist. The state remains completely clean and consistent.
3. **Recovery on Provider Re-try:**
   Payment providers adhere to retry schedules (exponential backoff). When the provider inevitably re-delivers the webhook, our system processes the event as a clean, fresh attempt without encountering corrupted or partial state.

---

### 3. Webhook Authentication: Verifying Request Authenticity

**Strategy:**
1. **HMAC Signature Verification (Shared Secret):**
   - The provider signs the raw request payload using an agreed-upon secret key with a cryptographic hash algorithm (typically HMAC-SHA256) and transmits the signature in an HTTP header (e.g. `X-Provider-Signature: sha256=...`).
   - Before parsing JSON into an object, our API extracts the raw request body bytes and recomputes `crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')`.
   - We compare signatures using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
2. **Replay Attack Prevention via Timestamps:**
   - The provider includes an `X-Provider-Timestamp` header in the signature calculation.
   - Our middleware verifies that `Math.abs(Date.now() - timestamp) <= 300_000` (e.g. 5 minutes). Expired timestamps are rejected.
3. **IP Whitelisting & Mutual TLS (mTLS):**
   - If the provider publishes static egress CIDR ranges, traffic is filtered at the cloud load balancer / ingress firewall level.
   - In enterprise banking architectures, mutual TLS (mTLS) with client certificates ensures cryptographic peer authentication at the transport layer.

---

### 4. Balance Reconciliation: Verifying Wallet Balances Against Event History

**Strategy:**
1. **Scheduled Reconciliation Job (Periodic Cron / Worker):**
   - A dedicated reconciliation worker runs periodically (e.g., daily at 00:00 UTC or hourly) using a read-replica database to avoid impacting operational traffic.
2. **Formula & Calculation:**
   For each wallet:
   $$\text{Calculated Balance} = \sum_{\substack{\text{status} = \text{'successful'}}} \text{amountKobo}$$
3. **Comparison & Discrepancy Handling:**
   - The worker compares `wallet.balanceKobo` with `Calculated Balance`.
   - If `wallet.balanceKobo !== Calculated Balance`:
     1. An immutable `ReconciliationDiscrepancy` record is generated with a timestamp, variance amount, and involved event IDs.
     2. An automated alert is sent to our internal engineering and operations team via Slack/PagerDuty.
     3. An operations dashboard visualizes unsettled discrepancies for manual review or automated re-sync scripts.
4. **Third-Party Provider Settlement File Reconciliation:**
   - In addition to internal ledger auditing, we ingest daily settlement reports (MT940, CSV, or CAMT.053) directly from the partner bank/provider.
   - We cross-reference provider `transactionRef` records against our internal database to detect any provider-side dropouts or fee discrepancies.

---

### 5. Missing Transactions: Handling Customer Funding Claims Without Webhooks

**Operational Runbook:**
1. **Step 1: Obtain Customer Proof & Identifiers:**
   Request the customer's transaction receipt containing:
   - External provider transaction ID / Bank session ID / Payment reference
   - Exact amount and timestamp
   - Wallet ID or account number used
2. **Step 2: Inspect Ingress & Dead-Letter Logs:**
   - Query our raw API gateway logs, cloud firewall logs, and dead-letter queues (DLQ) for the customer's wallet ID or external reference to check if the webhook was blocked, dropped due to a 5xx error, or failed HMAC verification.
3. **Step 3: Query Provider Verification API:**
   - Call the payment provider's Transaction Status / Query API using our authenticated server credentials (`GET /transactions/verify/:externalRef`).
   - Check if the provider acknowledges the payment as completed.
4. **Step 4: Remediation:**
   - **If the provider confirms success:**
     Manually trigger or replay the event through an internal ops endpoint (`POST /admin/reconcile/events`) or via an administrative CLI tool with audit metadata (`reason: "customer dispute resolved via provider query"`, `adminId: "ops_user_123"`). This routes through the exact same idempotent business logic to credit the customer safely.
   - **If the provider shows pending or failed:**
     Inform the customer that the payment failed or is awaiting bank clearance, providing the provider's official reference code for bank tracing.
   - **If the provider has no record:**
     The customer's bank transfer likely failed before leaving their source financial institution; direct the customer to their issuing bank with their debit session trace ID.
