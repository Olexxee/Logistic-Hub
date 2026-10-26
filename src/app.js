import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { serviceZonesRouter } from "./modules/geography/service-zones.routes.js";
import { mapsRouter } from "./modules/maps/maps.routes.js";
import { errorHandler } from "./shared/http/error-handler.js";
import { notFoundHandler } from "./shared/http/not-found.js";

export const app = express();

const allowedOrigins = env.CORS_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(pinoHttp({ redact: ["req.headers.authorization", "req.headers.cookie"] }));

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: "Logistic Hub API",
      version: "v1",
      health: "/api/v1/health",
      readiness: "/api/v1/health/ready",
    },
  });
});

app.use("/api/v1/health", healthRouter);
app.use("/api/v1/service-zones", serviceZonesRouter);
app.use("/api/v1/maps", mapsRouter);
app.use(notFoundHandler);
app.use(errorHandler);
