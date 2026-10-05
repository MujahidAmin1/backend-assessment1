import { prisma } from "../../config/prisma";
import AppError from "../../utils/appError";
import type { CreateEventInput, CreateWalletInput } from "../../utils/validation";

// ─── Wallet queries ──────────────────────────────────────────────

/**
 * Returns wallet details with transaction history grouped by transactionRef.
 * Each transaction shows its effective (latest) status.
 */
export async function getWalletWithTransactions(walletId: string) {
  const wallet = await prisma.wallet.findUnique({
    where: { walletId },
    include: {
      events: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!wallet) return null;

  // Aggregate events into a transaction-level view.
  // Events are ordered newest-first, so the first event we encounter
  // for each transactionRef carries the effective status.
  const txMap = new Map<
    string,
    { reference: string; amount: number; currency: string; status: string }
  >();

  for (const event of wallet.events) {
    if (!txMap.has(event.transactionRef)) {
      txMap.set(event.transactionRef, {
        reference: event.transactionRef,
        amount: event.amountKobo,
        currency: event.currency,
        status: event.status,
      });
    }
  }

  return {
    walletId: wallet.walletId,
    customerId: wallet.customerId,
    availableBalance: wallet.balanceKobo,
    currency: wallet.currency,
    transactions: Array.from(txMap.values()),
  };
}

// ─── Wallet creation ─────────────────────────────────────────────

export async function createWallet(input: CreateWalletInput) {
  try {
    return await prisma.wallet.create({
      data: {
        walletId: input.walletId,
        customerId: input.customerId,
        balanceKobo: input.balanceKobo,
        currency: input.currency,
      },
    });
  } catch (error: any) {
    // Prisma unique constraint violation
    if (error?.code === "P2002") {
      throw new AppError("Wallet already exists", 409);
    }
    throw error;
  }
}

// ─── Provider event processing ───────────────────────────────────

/**
 * Process an incoming deposit event from the payment provider.
 *
 * All checks and mutations run inside a single database transaction
 * to guarantee atomicity: the event record and the wallet balance
 * update either both commit or both roll back.
 *
 * Returns { event, created } where `created` indicates whether
 * a new event record was written (true) or an existing one was
 * returned idempotently (false).
 */
export async function processProviderEvent(input: CreateEventInput) {
  return prisma.$transaction(async (tx) => {
    // ── 1. Idempotency by eventId ──────────────────────────────
    const existingEvent = await tx.event.findUnique({
      where: { eventId: input.eventId },
    });

    if (existingEvent) {
      const isIdentical =
        existingEvent.transactionRef === input.transactionRef &&
        existingEvent.walletId === input.walletId &&
        existingEvent.amountKobo === input.amountKobo &&
        existingEvent.currency === input.currency;

      if (!isIdentical) {
        throw new AppError("eventId conflicts with an existing event", 409);
      }

      // Exact duplicate — safe to return without side effects.
      return { event: existingEvent, created: false };
    }

    // ── 2. Wallet must exist ───────────────────────────────────
    const wallet = await tx.wallet.findUnique({
      where: { walletId: input.walletId },
    });

    if (!wallet) {
      throw new AppError("Wallet does not exist", 404);
    }

    // ── 3. TransactionRef checks ───────────────────────────────
    const priorEvents = await tx.event.findMany({
      where: { transactionRef: input.transactionRef },
      orderBy: { createdAt: "desc" },
    });

    let shouldCredit = false;

    if (priorEvents.length > 0) {
      const reference = priorEvents[0];

      // Reject if wallet, amount, or currency differ from earlier events
      if (
        reference.walletId !== input.walletId ||
        reference.amountKobo !== input.amountKobo ||
        reference.currency !== input.currency
      ) {
        throw new AppError(
          "Transaction reference conflicts with existing transaction",
          409,
        );
      }

      // Terminal states are final — no further state changes allowed
      const terminalEvent = priorEvents.find(
        (e) => e.status === "successful" || e.status === "failed",
      );

      if (terminalEvent) {
        // Transaction already settled; acknowledge without recording.
        return { event: terminalEvent, created: false };
      }

      // Transaction is currently pending
      if (input.status === "pending") {
        // Duplicate pending — no state change
        return { event: reference, created: false };
      }

      // Transition: pending → successful or pending → failed
      shouldCredit = input.status === "successful";
    } else {
      // Brand-new transaction
      shouldCredit = input.status === "successful";
    }

    // ── 4. Persist the event ───────────────────────────────────
    const newEvent = await tx.event.create({
      data: {
        eventId: input.eventId,
        transactionRef: input.transactionRef,
        walletId: input.walletId,
        amountKobo: input.amountKobo,
        currency: input.currency,
        status: input.status,
      },
    });

    // ── 5. Credit wallet balance (successful deposits only) ────
    if (shouldCredit) {
      await tx.wallet.update({
        where: { walletId: input.walletId },
        data: { balanceKobo: { increment: input.amountKobo } },
      });
    }

    return { event: newEvent, created: true };
  });
}
