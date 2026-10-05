import { Router } from "express";
import { createWalletController, getWallet } from "./walletController";

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

/**
 * @openapi
 * /wallets:
 *   post:
 *     tags: [Wallets]
 *     summary: Create a new wallet
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateWalletInput'
 *     responses:
 *       201:
 *         description: Wallet created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Wallet'
 *       400:
 *         description: Invalid wallet payload
 *       409:
 *         description: Wallet already exists
 */
router.post("/", createWalletController);

export default router;
