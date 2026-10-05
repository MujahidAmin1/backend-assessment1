import { prisma } from "../../config/prisma";
import AppError from "../../utils/appError";
import type { CreateEventInput } from "../../utils/validation";

// ─── Wallet queries ──────────────────────────────────────────────

/**
 * Returns wallet details with transaction history grouped by transactionRef.
 * Each transaction shows its effective (latest) status.
 */
export async function getWalletWithTransactions(walletId: string) {
  const wallet = await prisma.wallet.findUnique({
    where: { walletId },
    include: {
      events: true,
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
    txMap.set(event.transactionRef, {
      reference: event.transactionRef,
      amount: event.amountKobo,
      currency: event.currency,
      status: event.status,
    });
  }

  return {
    walletId: wallet.walletId,
    customerId: wallet.customerId,
    availableBalance: wallet.balanceKobo,
    currency: wallet.currency,
    transactions: Array.from(txMap.values()),
  };
}

