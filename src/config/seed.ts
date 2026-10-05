import { prisma } from "./prisma";

export async function seedDatabase() {
  const wallet = await prisma.wallet.findUnique({
    where: { walletId: "W001" },
  });

  if (!wallet) {
    await prisma.wallet.create({
      data: {
        walletId: "W001",
        customerId: "C001",
        balanceKobo: 0,
        currency: "NGN",
      },
    });
    console.log("✓ Seeded wallet W001 (balance: 0, currency: NGN, customer: C001)");
  }
}
