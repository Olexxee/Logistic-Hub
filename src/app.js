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
import { geographyAdminRouter } from "./modules/geography/geography.admin.routes.js";
import { mapsRouter } from "./modules/maps/maps.routes.js";
import { parcelBookingsRouter } from "./modules/parcels/parcel-bookings.routes.js";
import { rideBookingsRouter } from "./modules/rides/ride-bookings.routes.js";
import { rideDispatchRouter } from "./modules/rides/ride-dispatch.routes.js";
import { dispatchRouter } from "./modules/dispatch/dispatch.routes.js";
import { deliveryLegDispatchRouter } from "./modules/delivery-legs/delivery-leg-dispatch.routes.js";
import { executionReadinessRouter } from "./modules/execution-readiness/execution-readiness.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { paymentsRouter } from "./modules/payments/payments.routes.js";
import { assignmentsRouter } from "./modules/assignments/assignments.routes.js";
import { supportRouter } from "./modules/support/support.routes.js";
import { mediaRouter } from "./modules/media/media.routes.js";
import { cancellationsRouter } from "./modules/cancellations/cancellations.routes.js";
import { financeRouter } from "./modules/finance/finance.routes.js";
import { partnerPricingRouter } from "./modules/partner-pricing/partner-pricing.routes.js";
import { platformRoutePricingRouter } from "./modules/platform-route-pricing/platform-route-pricing.routes.js";
import { platformOperationalTariffRouter } from "./modules/platform-operational-pricing/platform-operational-tariff.routes.js";
import { platformDriverPayoutRouter } from "./modules/platform-operational-pricing/platform-driver-payout.routes.js";
import { partnerExecutionRouter } from "./modules/partner-execution/partner-execution.routes.js";
import { custodyRouter } from "./modules/custody/custody.routes.js";
import { operationalCasesRouter } from "./modules/operational-cases/operational-cases.routes.js";
import { operationsControlRouter } from "./modules/operations-control/operations-control.routes.js";
import { partnerSettlementRouter } from "./modules/partner-settlement/partner-settlement.routes.js";
import { hubPointsRouter } from "./modules/hub-points/hub-points.routes.js";
import { driversRouter } from "./modules/drivers/drivers.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { discoveryRouter } from "./modules/discovery/discovery.routes.js";
import { adminUsersRouter } from "./modules/admin-users/admin-users.routes.js";
import { hubApplicationsRouter } from "./modules/hub-applications/hub-applications.routes.js";
import { integrationsAdminRouter } from "./modules/integrations/integrations-admin.routes.js";
import { integrationQuoteRouter } from "./modules/integrations/integration-quote.routes.js";
import { integrationShipmentRouter } from "./modules/integrations/integration-shipment.routes.js";
import { integrationPackingEvidenceRouter } from "./modules/integrations/integration-packing-evidence.routes.js";
import { integrationWebhookRouter } from "./modules/integrations/integration-webhook.routes.js";
import { errorHandler } from "./shared/http/error-handler.js";
import { runWithAuditContext } from "./shared/audit/audit-context.js";
import { notFoundHandler } from "./shared/http/not-found.js";

export const app = express();

const allowedOrigins = env.CORS_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false, credentials: true, allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Auth-CSRF", "X-File-Content-Type", "X-File-Name", "X-Document-Type", "X-Vehicle-ID", "X-Integration-Key-Id", "X-Integration-Secret", "X-Evidence-Slot", "X-Evidence-Actor-Reference"] }));
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use(pinoHttp({
  genReqId: () => randomUUID(),
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      // Query strings can contain one-time tokens or personal data.
      url: req.url?.split("?")[0],
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers.x-api-key",
    "req.headers.x-integration-secret",
    "res.headers.set-cookie",
  ],
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url?.split("?")[0]} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url?.split("?")[0]} ${res.statusCode}`,
}));

app.use((req, res, next) => {
  res.setHeader("X-Request-ID", req.id);
  runWithAuditContext({ requestId: req.id }, next);
});

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
app.use("/api/v1", discoveryRouter);
app.use("/api/v1/admin/users", adminUsersRouter);
app.use("/api/v1/admin/integrations", integrationsAdminRouter);
app.use("/api/v1/integrations", integrationShipmentRouter);
app.use("/api/v1/integrations", integrationPackingEvidenceRouter);
app.use("/api/v1/integrations", integrationWebhookRouter);
app.use("/api/v1/integrations", integrationQuoteRouter);
app.use("/api/v1", hubApplicationsRouter);
app.use("/api/v1/admin/platform-route-pricing", platformRoutePricingRouter);
app.use("/api/v1/admin/platform-operational-pricing", platformOperationalTariffRouter);
app.use("/api/v1/admin/platform-operational-pricing", platformDriverPayoutRouter);
app.use("/api/v1/admin/audit-events", auditRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/auth/sessions", authSessionsRouter);
app.use("/api/v1/geography/admin", geographyAdminRouter);
app.use("/api/v1/service-zones", serviceZonesRouter);
app.use("/api/v1/hub-points", hubPointsRouter);
app.use("/api/v1/drivers", driversRouter);
app.use("/api/v1/assignments", assignmentsRouter);
// Legacy financialRouter is intentionally not mounted. Finance operations live under /api/v1/finance.
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/support", supportRouter);
app.use("/api/v1/support", mediaRouter);
app.use("/api/v1/maps", requireAuth, mapsRouter);
app.use("/api/v1/parcel-bookings", requireAuth, parcelBookingsRouter);
app.use("/api/v1/ride-bookings", requireAuth, rideBookingsRouter);
app.use("/api/v1", rideDispatchRouter);
app.use("/api/v1", dispatchRouter);
app.use("/api/v1", deliveryLegDispatchRouter);
app.use("/api/v1", executionReadinessRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/v1/cancellations", cancellationsRouter);
app.use("/api/v1/finance", financeRouter);
app.use("/api/v1", partnerPricingRouter);
app.use("/api/v1", partnerExecutionRouter);
app.use("/api/v1", custodyRouter);
app.use("/api/v1", operationalCasesRouter);
app.use("/api/v1", operationsControlRouter);
app.use("/api/v1", partnerSettlementRouter);
app.use(notFoundHandler);
app.use(errorHandler);
