import { Router } from "express";
import { getWallet } from "./walletController";

const router = Router();

/**
 * @openapi
 * /wallets/{walletId}:
 *   get:
 *     tags: [Wallets]
 *     summary: Get wallet details with transaction history
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Wallet balance and transaction history
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletDetails'
 *       404:
 *         description: Wallet not found
 */
router.get("/:walletId", getWallet);



export default router;
