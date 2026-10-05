import { prisma } from "../../config/prisma";
import AppError from "../../utils/appError";
import type { CreateEventInput } from "../../utils/validation";

export async function processProviderEvent(input: CreateEventInput) {
  return prisma.$transaction(async (tx) => {
    // Check whether we have already received this exact event.
    //
    // eventId is the provider's identifier for a particular event.
    // Receiving the same event again should have no additional effect.
    const existingEvent = await tx.event.findUnique({
      where: {
        eventId: input.eventId,
      },
    });

    if (existingEvent) {
      // A reused eventId is only acceptable if the important
      // transaction details are the same as the original event.
      //
      // For example, E001 originally says ₦2,500 but someone later
      // sends E001 with ₦5,000. That must be rejected.
      const hasConflict =
        existingEvent.transactionRef !== input.transactionRef ||
        existingEvent.walletId !== input.walletId ||
        existingEvent.amountKobo !== input.amountKobo ||
        existingEvent.currency !== input.currency;

      if (hasConflict) {
        throw new AppError(
          "eventId conflicts with an existing event",
          409,
        );
      }

      // Same eventId with the same details means this is a replay.
      // Return the existing event without changing the wallet.
      return existingEvent;
    }

    // The wallet must exist before we can process the deposit.
    const wallet = await tx.wallet.findUnique({
      where: {
        walletId: input.walletId,
      },
    });

    if (!wallet) {
      throw new AppError("wallet does not exist", 404);
    }

    // Look for an existing event belonging to the same transaction.
    //
    // We use transactionRef to identify the underlying transaction,
    // because a provider can send multiple events for the same transaction.
    //
    // Example:
    // E001 → T001 → pending
    // E002 → T001 → successful
    //
    // These are two events for the same transaction.
    const existingTransaction = await tx.event.findFirst({
      where: {
        transactionRef: input.transactionRef,
      },
      orderBy: {
        eventId: "desc",
      },
    });

    // This is a brand-new transaction.
    if (!existingTransaction) {
      // Create the first event for this transaction.
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

      // Only a successful deposit increases the available balance.
      if (input.status === "successful") {
        await tx.wallet.update({
          where: {
            walletId: input.walletId,
          },
          data: {
            balanceKobo: {
              increment: input.amountKobo,
            },
          },
        });
      }

      return newEvent;
    }

    // The same transactionRef must always refer to the same
    // wallet, amount and currency.
    //
    // If T001 originally represented:
    // W001 / 250000 / NGN
    //
    // we must reject a later T001 saying:
    // W001 / 300000 / NGN
    const hasTransactionConflict =
      existingTransaction.walletId !== input.walletId ||
      existingTransaction.amountKobo !== input.amountKobo ||
      existingTransaction.currency !== input.currency;

    if (hasTransactionConflict) {
      throw new AppError(
        "transaction reference conflicts with existing transaction",
        409,
      );
    }

    // Successful and failed are terminal states.
    //
    // Once a transaction reaches either state, later events must not
    // change its status or affect the wallet balance.
    if (
      existingTransaction.status === "successful" ||
      existingTransaction.status === "failed"
    ) {
      return existingTransaction;
    }

    // At this point the existing transaction is pending.
    //
    // A later pending event doesn't change anything.
    if (input.status === "pending") {
      return existingTransaction;
    }

    // Pending → failed.
    //
    // The transaction becomes terminal, but the wallet is not credited.
    if (input.status === "failed") {
      return tx.event.update({
        where: {
          eventId: existingTransaction.eventId,
        },
        data: {
          status: "failed",
        },
      });
    }

    // The only remaining possibility is:
    //
    // pending → successful
    //
    // This is the point where we credit the wallet.
    const updatedEvent = await tx.event.update({
      where: {
        eventId: existingTransaction.eventId,
      },
      data: {
        status: "successful",
      },
    });

    // The event status update and wallet credit happen inside
    // the same database transaction.
    //
    // If either operation fails, Prisma rolls the whole transaction back.
    await tx.wallet.update({
      where: {
        walletId: input.walletId,
      },
      data: {
        balanceKobo: {
          increment: input.amountKobo,
        },
      },
    });

    return updatedEvent;
  });
}