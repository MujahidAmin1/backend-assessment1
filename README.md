
# Wallet API Assessment

Hey there! 👋 This is my submission for the Backend Developer Internship Assessment. 

I've built a small Node.js & TypeScript API using Express that handles wallet balances and processes incoming events from a payment provider. I focused heavily on making sure the data stays consistent, even if things crash or duplicate requests come in.

---

## What I Built & Why

Here are some of the main decisions I made while putting this together:

- **All-or-Nothing Transactions:** When a successful deposit comes in, we have to save the event *and* update the wallet balance. I wrapped both of these database calls in a single Prisma transaction. If one fails, they both roll back. This means we never end up with a ghost event that didn't credit the user, or vice versa.
- **Keeping an Audit Trail:** I never overwrite events in the database. If a transaction goes from `pending` to `successful`, I insert a *new* event row. This gives us a permanent history of exactly how and when a transaction's state changed. 
- **Handling Duplicates Safely:** Provider requests can be messy—providers often retry requests if they think we didn't get them. I handle this by checking if we've seen the `eventId` before. If we have, I just return a 200 OK without doing anything. If the transaction has already reached a final state (like `successful` or `failed`), I ignore any late-arriving `pending` events for it.
- **Validation:** I used Zod to strictly validate everything coming into the API. If the currency isn't exactly `NGN`, or if the amount is negative, it immediately rejects the request with a 400 Bad Request.

---

## Running the App Locally

If you want to spin this up on your machine, here's how:

### Prerequisites
- Node.js (v18 or higher)
- npm

### Setup

1. **Install the dependencies:**
   ```bash
   npm install
   ```

2. **Set up the database:**
   This will create a local SQLite database (`dev.db`) and push the schema to it.
   ```bash
   npx prisma generate
   npx prisma db push
   ```

3. **Seed the database:**
   The assessment asked for a specific wallet (`W001`) to exist. You can create it by running:
   ```bash
   npm run seed
   ```
   *(Note: The server also automatically runs this check when it boots up, just in case!)*

4. **Start the server:**
   ```bash
   npm run dev
   ```
   The API will be live at `http://localhost:3000`. 
   If you want to play around with the endpoints visually, check out the Swagger docs at `http://localhost:3000/api-docs`.

---

## Running the Tests

I wrote a suite of integration tests using **Vitest** and **Supertest**. They cover all 5 scenarios mentioned in the prompt, plus some extra edge cases like missing wallets and validation errors.

To run them, just do:
```bash
npm test
```
All 11 tests should pass green. ✅

---

## API Examples

Here are a few quick `curl` commands to show how the API works.

### 1. Process a Provider Event
`POST /provider/events`

Send a successful deposit event to credit the wallet:
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

### 2. Check the Wallet Balance
`GET /wallets/W001`

Check how much money is in the wallet and see the history of transactions. (Notice how the transactions array automatically groups events by their reference and shows the latest status!)
```bash
curl -X GET http://localhost:3000/wallets/W001
```

---

## Time Spent
- **Reading & Planning:** 20 mins
- **Coding the API:** 60 mins
- **Writing Tests:** 25 mins
- **Documentation & Written Answers:** 30 mins
- **Total Time:** ~2 hours 15 minutes

---

## Assumptions I Made
1. **No decimal math:** I assumed all amounts are in minor units (Kobo) as integers. Dealing with floating-point math for money usually ends in disaster, so integers are the way to go.
2. **Terminal states:** I assumed that once a transaction hits `successful` or `failed`, that's the end of its lifecycle. It can't go back to `pending`.
3. **Data shape:** For the GET request, the prompt asked for "transaction history". Since we store every single state change as a new row, I decided to aggregate them in the response. If `T001` has a pending event and a successful event, the API just returns one entry for `T001` showing it as `successful`. This felt much cleaner for whoever is consuming the API.

---

## Known Limitations & What I'd Do Next
1. **SQLite Concurrency:** Right now, the app uses SQLite. It works fine for a local assessment, but under heavy load with concurrent requests, SQLite locks the whole database file to write. 
   - **Next Improvement:** I'd swap SQLite for PostgreSQL. Then, I'd use row-level locking (`SELECT ... FOR UPDATE`) in the transaction to make absolutely sure two identical requests can't slip past each other at the exact same millisecond.
2. **Provider webhook authenticity**
   The endpoint currently trusts incoming provider events. In production, webhook requests should be authenticated using the provider's signature/secret and validated before processing. This prevents unauthorized clients from submitting fake successful deposits.
3. **Synchronous Requests:** Currently, we process the event and update the database while the provider is waiting on the HTTP request. If our database is slow, the provider might time out.
   - **Next Improvement:** I'd drop incoming provider events into a message queue (like RabbitMQ or AWS SQS) and immediately return a `202 Accepted`. Then, background workers could process the events at their own pace without dropping anything.

---

## Written Explanations (Section 2)

I've put my detailed answers to the 5 conceptual questions from the prompt into a separate file. 

👉 **You can read them here: [EXPLANATION.md](./EXPLANATION.md)**
