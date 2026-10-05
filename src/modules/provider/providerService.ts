import { prisma } from "../../config/prisma";
import AppError from "../../utils/appError";
import type { CreateEventInput } from "../../utils/validation";

export async function processProviderEvent(input: CreateEventInput) {
  return prisma.$transaction(async (tx) => {
    const existingEvent = await tx.event.findUnique({
      where: {
        eventId: input.eventId,
      },
    });

    if (existingEvent) {
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

      return existingEvent;
    }

    const wallet = await tx.wallet.findUnique({
      where: {
        walletId: input.walletId,
      },
    });

    if (!wallet) {
      throw new AppError("wallet does not exist", 404);
    }

    const existingTransaction = await tx.event.findFirst({
      where: {
        transactionRef: input.transactionRef,
      },
      orderBy: {
        eventId: "desc",
      },
    });

    if (!existingTransaction) {
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

    if (
      existingTransaction.status === "successful" ||
      existingTransaction.status === "failed"
    ) {
      return existingTransaction;
    }

    if (input.status === "pending") {
      return existingTransaction;
    }

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

    const updatedEvent = await tx.event.update({
      where: {
        eventId: existingTransaction.eventId,
      },
      data: {
        status: "successful",
      },
    });

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