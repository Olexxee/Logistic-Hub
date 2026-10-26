import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { createHubPointsService } from "./hub-points.service.js";
import { listHubPointsQuerySchema } from "./hub-points.schemas.js";

export function createHubPointsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createHubPointsService({ prismaClient });

  router.get("/", async (req, res, next) => {
    const parsed = listHubPointsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "One or more query parameters are invalid.",
          details: parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
        },
      });
    }
    try {
      const result = await service.listActive(parsed.data);
      return res.status(200).json({ success: true, data: result.data, page: { nextCursor: result.nextCursor } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const hubPointsRouter = createHubPointsRouter();
