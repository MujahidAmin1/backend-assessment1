import { Router } from "express";
import { processEvent } from "./providerController";

const router = Router();

/**
 * @openapi
 * /provider/events:
 *   post:
 *     tags: [Provider]
 *     summary: Receive a provider deposit event
 *     description: >
 *       Accept incoming deposit events from the payment provider.
 *       Handles idempotency, conflict detection, and wallet balance updates.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Event'
 *     responses:
 *       201:
 *         description: Event accepted and processed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Event'
 *       200:
 *         description: Idempotent replay — no state change
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Event'
 *       400:
 *         description: Invalid event payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Conflicting event data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/events", processEvent);

export default router;
