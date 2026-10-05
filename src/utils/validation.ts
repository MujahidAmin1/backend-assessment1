import { z } from "zod";

export const createEventSchema = z
  .object({
    eventId: z
      .string({ error: "Event ID is required" })
      .trim()
      .min(1, "Event ID is required")
      .max(100, "Event ID cannot exceed 100 characters"),
    transactionRef: z
      .string({ error: "Transaction reference is required" })
      .trim()
      .min(1, "Transaction reference is required")
      .max(255, "Transaction reference cannot exceed 255 characters"),
    walletId: z
      .string({ error: "Wallet ID is required" })
      .trim()
      .min(1, "Wallet ID is required")
      .max(100, "Wallet ID cannot exceed 100 characters"),
    amountKobo: z
      .number({ error: "Amount must be a number" })
      .int("Amount must be a whole number")
      .positive("Amount must be greater than zero"),
    currency: z
      .string({ error: "Currency is required" })
      .trim()
      .toUpperCase()
      .refine((val) => val === "NGN", "Currency must be NGN"),
    status: z.enum(["pending", "successful", "failed"] as const, {
      error: "Status must be pending, successful, or failed",
    }),
  })
  .strict();

export type CreateEventInput = z.infer<typeof createEventSchema>;
