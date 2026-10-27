import { Router } from "express";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";

const SERVICE_NAME = "logistic-hub-api";

function healthPayload(status, extra = {}) {
  return {
    success: true,
    data: {
      service: SERVICE_NAME,
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      ...extra,
    },
  };
}

export function createHealthRouter({ prismaClient = prisma } = {}) {
  const router = Router();

  // Liveness confirms that the Node process is running; it intentionally does not
  // depend on external services so orchestrators do not restart a healthy process
  // merely because the database is temporarily unavailable.
  router.get(["/", "/live"], (_req, res) => {
    return res.status(200).json(healthPayload("ok", {
      environment: env.NODE_ENV,
      paymentsEnabled: env.PAYMENTS_ENABLED,
    }));
  });

  // Readiness confirms the API can serve requests that require the database.
  router.get("/ready", async (req, res) => {
    const checkStartedAt = Date.now();

    try {
      await prismaClient.$queryRaw`SELECT 1`;
      const databaseLatencyMs = Date.now() - checkStartedAt;

      return res.status(200).json(healthPayload("ready", {
        dependencies: {
          database: {
            status: "ok",
            latencyMs: databaseLatencyMs,
          },
        },
      }));
    } catch (error) {
      req.log?.warn({
        dependency: "database",
        errorName: error?.name,
        errorCode: error?.code,
        latencyMs: Date.now() - checkStartedAt,
      }, "Readiness check failed");

      return res.status(503).json({
        success: false,
        data: {
          service: SERVICE_NAME,
          status: "not_ready",
          dependencies: {
            database: { status: "unavailable" },
          },
          timestamp: new Date().toISOString(),
        },
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
