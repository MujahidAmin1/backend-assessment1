import { prisma } from "../../config/prisma";

export async function getWalletWithTransactions(walletId: string) {
  const wallet = await prisma.wallet.findUnique({
    where: {
      walletId,
    },
    include: {
      events: true,
    },
  });

  if (!wallet) {
    return null;
  }

  return {
    walletId: wallet.walletId,
    customerId: wallet.customerId,
    availableBalanceKobo: wallet.balanceKobo,
    currency: wallet.currency,

    transactions: wallet.events.map((event) => ({
      reference: event.transactionRef,
      amountKobo: event.amountKobo,
      currency: event.currency,
      status: event.status,
    })),
  };
}

