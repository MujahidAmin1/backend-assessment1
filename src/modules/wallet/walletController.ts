import { Request, Response, NextFunction } from "express";
import AppError from "../../utils/appError";
import { getWalletWithTransactions } from "./walletService";

export async function getWallet(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const walletId = req.params.walletId;

    if (typeof walletId !== "string" || !walletId.trim()) {
      throw new AppError("walletId is required", 400);
    }

    const wallet = await getWalletWithTransactions(walletId);

    if (!wallet) {
      throw new AppError("Wallet does not exist", 404);
    }

    res.status(200).json(wallet);
  } catch (error) {
    next(error);
  }
}
