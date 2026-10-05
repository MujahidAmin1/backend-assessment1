import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../config/prisma";

describe("Wallet & Provider Events API", () => {
  beforeEach(async () => {
    // Reset database to known seed state before each test
    await prisma.event.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.wallet.create({
      data: {
        walletId: "W001",
        customerId: "C001",
        balanceKobo: 0,
        currency: "NGN",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("POST /provider/events", () => {
    it("Scenario 1: Pending event records event and does not credit wallet balance", async () => {
      const payload = {
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000, // 500 NGN
        currency: "NGN",
        status: "pending",
      };

      const res = await request(app).post("/provider/events").send(payload);
      expect(res.status).toBe(201);
      expect(res.body.eventId).toBe("E001");
      expect(res.body.status).toBe("pending");

      // Verify wallet balance is unchanged
      const walletRes = await request(app).get("/wallets/W001");
      expect(walletRes.status).toBe(200);
      expect(walletRes.body.availableBalanceKobo).toBe(0);
      expect(walletRes.body.transactions).toHaveLength(1);
      expect(walletRes.body.transactions[0]).toEqual({
        reference: "T001",
        amountKobo: 50000,
        currency: "NGN",
        status: "pending",
      });
    });

    it("Scenario 2: Successful event for existing pending event credits wallet balance once", async () => {
      // 1. Send pending event E001 for T001
      await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "pending",
      });

      // 2. Send successful event E002 for T001
      const res = await request(app).post("/provider/events").send({
        eventId: "E002",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "successful",
      });

      expect(res.status).toBe(201);
      expect(res.body.eventId).toBe("E001"); // It updates the original event
      expect(res.body.status).toBe("successful");

      // Verify wallet balance is credited
      const walletRes = await request(app).get("/wallets/W001");
      expect(walletRes.status).toBe(200);
      expect(walletRes.body.availableBalanceKobo).toBe(50000);

      // Verify event is updated for audit traceability
      const eventsInDb = await prisma.event.findMany({
        where: { transactionRef: "T001" },
      });
      expect(eventsInDb).toHaveLength(1);
      expect(eventsInDb[0].eventId).toBe("E001");

      // Transaction history shows effective status 'successful'
      expect(walletRes.body.transactions).toHaveLength(1);
      expect(walletRes.body.transactions[0].status).toBe("successful");
    });

    it("Scenario 3: Failed event records event but does not credit wallet balance", async () => {
      const res = await request(app).post("/provider/events").send({
        eventId: "E003",
        transactionRef: "T002",
        walletId: "W001",
        amountKobo: 25000,
        currency: "NGN",
        status: "failed",
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("failed");

      const walletRes = await request(app).get("/wallets/W001");
      expect(walletRes.body.availableBalanceKobo).toBe(0);
      expect(walletRes.body.transactions[0].status).toBe("failed");
    });

    it("Scenario 4: Terminal state is immutable (subsequent events ignored without duplicate credit)", async () => {
      // 1. Make transaction successful
      await request(app).post("/provider/events").send({
        eventId: "E002",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "successful",
      });

      // 2. Late-arriving pending event for the same transaction
      const res = await request(app).post("/provider/events").send({
        eventId: "E004",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "pending",
      });

      // Returns 201 OK acknowledging existing terminal state, does not record new event
      expect(res.status).toBe(201);

      // Balance remains 50000 (no double credit or reversal)
      const walletRes = await request(app).get("/wallets/W001");
      expect(walletRes.body.availableBalanceKobo).toBe(50000);

      // Database has only the original successful event
      const events = await prisma.event.findMany({ where: { transactionRef: "T001" } });
      expect(events).toHaveLength(1);
      expect(events[0].eventId).toBe("E002");
    });

    it("Scenario 5: Replaying exact duplicate eventId is idempotent", async () => {
      const payload = {
        eventId: "E002",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "successful",
      };

      const firstRes = await request(app).post("/provider/events").send(payload);
      expect(firstRes.status).toBe(201);

      // Replay identical event
      const replayRes = await request(app).post("/provider/events").send(payload);
      expect(replayRes.status).toBe(201);
      expect(replayRes.body.eventId).toBe("E002");

      // Balance credited only once
      const walletRes = await request(app).get("/wallets/W001");
      expect(walletRes.body.availableBalanceKobo).toBe(50000);
    });

    it("Rejects conflicting payload for already seen eventId with 409", async () => {
      await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "pending",
      });

      // Same eventId but different amount
      const res = await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 99999,
        currency: "NGN",
        status: "pending",
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/conflicts with an existing event/i);
    });

    it("Rejects conflicting transactionRef metadata (different amount/wallet/currency) with 409", async () => {
      await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "pending",
      });

      // Different amount for same transactionRef
      const res = await request(app).post("/provider/events").send({
        eventId: "E002",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 60000,
        currency: "NGN",
        status: "successful",
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/conflicts with existing transaction/i);
    });

    it("Returns 404 when wallet does not exist", async () => {
      const res = await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W999",
        amountKobo: 50000,
        currency: "NGN",
        status: "successful",
      });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/wallet does not exist/i);
    });

    it("Rejects invalid payload validations with 400", async () => {
      // Negative amount
      let res = await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: -100,
        currency: "NGN",
        status: "successful",
      });
      expect(res.status).toBe(400);

      // Zero amount
      res = await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 0,
        currency: "NGN",
        status: "successful",
      });
      expect(res.status).toBe(400);

      // Invalid currency (non-NGN)
      res = await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 5000,
        currency: "USD",
        status: "successful",
      });
      expect(res.status).toBe(400);

      // Invalid status
      res = await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 5000,
        currency: "NGN",
        status: "unknown_status",
      });
      expect(res.status).toBe(400);

      // Missing required fields
      res = await request(app).post("/provider/events").send({
        eventId: "E001",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /wallets/:walletId", () => {
    it("Returns 200 with shaped wallet details and transaction history", async () => {
      // Create pending and then successful event for T001
      await request(app).post("/provider/events").send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "pending",
      });
      await request(app).post("/provider/events").send({
        eventId: "E002",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "successful",
      });

      // Create failed event for T002
      await request(app).post("/provider/events").send({
        eventId: "E003",
        transactionRef: "T002",
        walletId: "W001",
        amountKobo: 15000,
        currency: "NGN",
        status: "failed",
      });

      const res = await request(app).get("/wallets/W001");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        walletId: "W001",
        customerId: "C001",
        availableBalanceKobo: 50000,
        currency: "NGN",
        transactions: expect.arrayContaining([
          {
            reference: "T001",
            amountKobo: 50000,
            currency: "NGN",
            status: "successful",
          },
          {
            reference: "T002",
            amountKobo: 15000,
            currency: "NGN",
            status: "failed",
          },
        ]),
      });
    });

    it("Returns 404 for non-existent wallet", async () => {
      const res = await request(app).get("/wallets/NON_EXISTENT");
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/wallet does not exist/i);
    });
  });


});
