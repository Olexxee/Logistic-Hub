import { Router } from "express";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { createServiceZonesService } from "./service-zones.service.js";
import { listServiceZonesQuerySchema } from "./service-zones.schemas.js";

export function createServiceZonesRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createServiceZonesService({ prismaClient });

  router.get("/", async (req, res, next) => {
    const parsed = listServiceZonesQuerySchema.safeParse(req.query);
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
      const data = await service.listActive(parsed.data);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "One or more query parameters are invalid.",
            details: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
          },
        });
      }
      return next(error);
    }
  });

  return router;
}

export const serviceZonesRouter = createServiceZonesRouter();
