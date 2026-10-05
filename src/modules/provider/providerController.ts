import { Request, Response, NextFunction } from "express";
import AppError from "../../utils/appError";
import { createEventSchema } from "../../utils/validation";
import { processProviderEvent } from "./providerService";

export async function processEvent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = createEventSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid event payload",
        400,
      );
    }

    const result = await processProviderEvent(parsed.data);
    res.status(result.created ? 201 : 200).json(result.event);
  } catch (error) {
    next(error);
  }
}
