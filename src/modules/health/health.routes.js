import { Router } from "express";
import { env } from "../../config/env.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
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
