# Section 2: Written Explanation

Here are my answers to the five architectural questions from the assessment. I tried to focus on practical solutions for how these things actually break in the real world.

---

### 1. Concurrency: Preventing Duplicate Credits

**Problem:** What if two requests for the exact same deposit hit our API at the exact same millisecond? If we aren't careful, both requests might read the old balance (say, 0), add 500 to it, and save it. We'd end up crediting the user twice.

**How I'd fix it:**
For this assessment, SQLite's single-writer lock kind of protects us, but in a real production app (like with PostgreSQL), we need a stronger guarantee.

1. **Database-level row locks (`SELECT ... FOR UPDATE`):** When processing a deposit, we should lock the wallet row in the database for the duration of the transaction. If a second request comes in for the same wallet, it has to wait until the first request is completely done (either committed or rolled back) before it can even read the balance.
2. **Idempotency keys:** We'd also rely on the database's unique constraints. By enforcing a rule in the database that an `eventId` can only exist once, the second request would just fail with a "unique constraint violation" when it tries to insert the event. We catch that error and know it's a duplicate.

---

### 2. Crash Recovery: Database Failure Mid-Transaction

**Problem:** What if the server crashes *after* we record the event but *before* we add the money to the wallet?

**How I handled it:**
This is exactly why I wrapped the whole process inside a Prisma transaction (`prisma.$transaction`). 

Databases are built to handle this using something called ACID guarantees. If the power goes out right after saving the event but before updating the wallet, the database realizes the transaction never fully finished (it never committed). When it boots back up, it automatically rolls back that partial insert. It's an all-or-nothing deal. 

Because we roll back cleanly, when the payment provider inevitably retries the request a few minutes later, our system just processes it like a brand new event. No weird partial states to clean up.

---

### 3. API Authentication: Verifying Request Authenticity

**Problem:** How do we know it's actually the bank calling our provider endpoint and not some random hacker trying to give themselves free money?

**How I'd secure it:**
You never trust data just because it hits your endpoint. 

1. **HMAC Signatures (The standard way):** The provider should take the request body and sign it using a secret key only we and they know, usually creating a hash (like HMAC-SHA256). They send this hash in a header (like `X-Signature`). When we receive the request, we take the raw body, hash it with the same secret key, and compare our hash to theirs. If they match, we know the request hasn't been tampered with and it actually came from them.
2. **Timestamp Checks:** To prevent someone from intercepting a valid request and just re-sending it later (a replay attack), the provider should include a timestamp in the signature. We'd check that the timestamp is within a reasonable window (like 5 minutes).
3. **IP Whitelisting:** As an extra layer, we'd configure our firewall to only accept traffic on the provider endpoint from the provider's known IP addresses.

---

### 4. Balance Reconciliation: Verifying Wallet Balances Against Event History

**Problem:** Over time, bugs happen. How do we ensure the wallet balance exactly matches the sum of all their successful deposits?

**How I'd verify it:**
You need an automated script running in the background—usually a nightly cron job—that acts as an auditor.

1. The script loops through all wallets.
2. For each wallet, it adds up the `amountKobo` for every event where the status is `successful`. 
3. It compares that calculated total to the actual `balanceKobo` saved on the wallet.

If the numbers don't match, the script shouldn't try to automatically fix it (that's dangerous). Instead, it should flag the discrepancy, save it to a "Reconciliation Issues" table, and alert the engineering/ops team on Slack or PagerDuty so a human can investigate what went wrong.

---

### 5. Missing Transactions: Handling Customer Funding Claims Without Incoming Requests

**Problem:** A customer says "I sent you money!" but our database has zero record of it. 

**Steps I'd take to investigate and fix:**

1. **Get the proof:** First, ask the customer for their receipt from the bank (we need the transaction reference number and the exact time/amount).
2. **Check our front door:** Look at our server's raw access logs or firewall logs. Did the provider's request actually hit our server? If it did, maybe it failed authentication or crashed our app (returning a 500 error).
3. **Ask the provider's API:** The most important step is to call the payment provider's API directly (like a `GET /transactions/{reference}` endpoint) to ask, "Hey, did this transaction actually succeed?" 
4. **Fix it:** 
   - If the provider says "Yes, it succeeded," then it was our fault for missing the incoming request. We'd have a secure, internal admin endpoint where our support team can manually trigger the deposit using the exact same logic.
   - If the provider says "It failed" or "We have no record of that," we tell the customer the payment didn't go through on their bank's end and they need to contact their bank.
