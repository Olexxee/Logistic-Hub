import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { authSessionsRouter } from "./modules/auth/auth-sessions.routes.js";
import { requireAuth } from "./modules/auth/auth.middleware.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { serviceZonesRouter } from "./modules/geography/service-zones.routes.js";
import { mapsRouter } from "./modules/maps/maps.routes.js";
import { parcelBookingsRouter } from "./modules/parcels/parcel-bookings.routes.js";
import { rideBookingsRouter } from "./modules/rides/ride-bookings.routes.js";
import { rideDispatchRouter } from "./modules/rides/ride-dispatch.routes.js";
import { dispatchRouter } from "./modules/dispatch/dispatch.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { paymentsRouter } from "./modules/payments/payments.routes.js";
import { financialRouter } from "./modules/payments/financial.routes.js";
import { assignmentsRouter } from "./modules/assignments/assignments.routes.js";
import { supportRouter } from "./modules/support/support.routes.js";
import { cancellationsRouter } from "./modules/cancellations/cancellations.routes.js";
import { financeRouter } from "./modules/finance/finance.routes.js";
import { hubPointsRouter } from "./modules/hub-points/hub-points.routes.js";
import { driversRouter } from "./modules/drivers/drivers.routes.js";
import { errorHandler } from "./shared/http/error-handler.js";
import { notFoundHandler } from "./shared/http/not-found.js";

export const app = express();

const allowedOrigins = env.CORS_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use(pinoHttp({
  genReqId: () => randomUUID(),
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers.x-api-key",
    "res.headers.set-cookie",
  ],
  customProps: (req) => ({ requestId: req.id }),
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customReceivedMessage: (req) => `HTTP request started: ${req.method} ${req.url}`,
  customSuccessMessage: (req, res) => `HTTP request completed: ${req.method} ${req.url} (${res.statusCode})`,
  customErrorMessage: (req, res, error) => `HTTP request failed: ${req.method} ${req.url} (${res.statusCode}): ${error?.message ?? "unknown error"}`,
}));

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: "Logistic Hub API",
      version: "v1",
      health: "/api/v1/health",
      liveness: "/api/v1/health/live",
      readiness: "/api/v1/health/ready",
      authentication: "/api/v1/auth",
    },
  });
});

app.use("/api/v1/health", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/auth/sessions", authSessionsRouter);
app.use("/api/v1/service-zones", serviceZonesRouter);
app.use("/api/v1/hub-points", hubPointsRouter);
app.use("/api/v1/drivers", driversRouter);
app.use("/api/v1/assignments", assignmentsRouter);
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/payments", financialRouter);
app.use("/api/v1/support", supportRouter);
app.use("/api/v1/maps", requireAuth, mapsRouter);
app.use("/api/v1/parcel-bookings", requireAuth, parcelBookingsRouter);
app.use("/api/v1/ride-bookings", requireAuth, rideBookingsRouter);
app.use("/api/v1", rideDispatchRouter);
app.use("/api/v1", dispatchRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/v1/cancellations", cancellationsRouter);
app.use("/api/v1/finance", financeRouter);
app.use(notFoundHandler);
app.use(errorHandler);
