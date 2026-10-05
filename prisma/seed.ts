import { prisma } from "../src/config/prisma";

async function main() {
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
    console.log("✓ Seeded wallet W001");
  } else {
    console.log("✓ Wallet W001 already exists");
  }
}

main().catch(console.error);
