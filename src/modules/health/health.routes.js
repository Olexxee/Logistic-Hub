import { Router } from "express";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";

export function createHealthRouter({ prismaClient = prisma } = {}) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        service: "logistic-hub-api",
        status: "ok",
        environment: env.NODE_ENV,
        paymentsEnabled: env.PAYMENTS_ENABLED,
        timestamp: new Date().toISOString(),
      },
    });
  });

  router.get("/ready", async (_req, res) => {
    try {
      await prismaClient.$queryRaw`SELECT 1`;
      return res.status(200).json({
        success: true,
        data: {
          service: "logistic-hub-api",
          status: "ready",
          dependencies: { database: "ok" },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      _req.log?.warn({ err: error }, "Database readiness check failed");
      return res.status(503).json({
        success: false,
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "A required service is temporarily unavailable.",
        },
      });
    }
  });

  return router;
}

export const healthRouter = createHealthRouter();
