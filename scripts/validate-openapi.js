import SwaggerParser from "@apidevtools/swagger-parser";
import { fileURLToPath } from "node:url";

const specPath = fileURLToPath(new URL("../docs/openapi.yaml", import.meta.url));
const allowedStatuses = new Set(["implemented", "planned", "planned-disabled"]);
const implementedOperations = new Set([
  "GET /health",
  "GET /health/ready",
  "GET /service-zones",
  "POST /maps/geocode",
  "POST /maps/routes",
  "POST /auth/register",
  "POST /auth/verify-email",
  "POST /auth/login",
  "POST /auth/password/forgot",
  "POST /auth/password/reset",
  "GET /auth/me",
  "GET /drivers/me",
  "POST /drivers/onboarding",
  "PATCH /drivers/availability",
  "POST /drivers/location",
  "GET /admin/audit-events",
  "PATCH /drivers/admin/{driverProfileId}/verification",
  "PATCH /drivers/admin/vehicles/{vehicleId}/verification",
  "PUT /drivers/admin/coverage",
  "GET /drivers/admin/drivers",
  "PATCH /drivers/admin/drivers/{driverProfileId}/status",
  "GET /drivers/admin/drivers/{driverProfileId}/audit",
  "GET /drivers/admin/vehicles",
  "GET /hub-points",
  "GET /hub-points/admin",
  "POST /hub-points/admin",
  "PATCH /hub-points/admin/{hubPointId}",
  "PATCH /hub-points/admin/{hubPointId}/status",
  "PATCH /hub-points/admin/{hubPointId}/operator-verification",
  "GET /notifications",
  "PATCH /notifications/{notificationId}/read",
  "POST /notifications/read-all",
  "GET /parcel-bookings",
  "POST /parcel-bookings",
  "GET /parcel-bookings/{bookingId}",
  "GET /parcel-bookings/{bookingId}/delivery-legs",
  "POST /parcel-bookings/{bookingId}/request-matching",
  "GET /parcel-bookings/{bookingId}/offers",
  "GET /driver/offers",
  "POST /driver/offers/{offerId}/propose-fare",
  "POST /parcel-bookings/{bookingId}/accept-fare",
  "POST /ride-bookings",
  "GET /ride-bookings/{rideBookingId}",
  "POST /ride-bookings/{rideBookingId}/request-matching",
  "GET /ride-bookings/{rideBookingId}/offers",
  "GET /driver/ride-offers",
  "POST /driver/ride-offers/{offerId}/propose-fare",
  "POST /ride-bookings/{rideBookingId}/accept-fare",
  "POST /auth/refresh",
  "POST /payments/initialize",
  "POST /auth/logout",
  "POST /auth/logout-all",
  "POST /assignments/{assignmentId}/verification-code",
  "POST /assignments/{assignmentId}/arrived-at-pickup",
  "POST /assignments/{assignmentId}/verify-code",
  "POST /assignments/{assignmentId}/start-transit",
  "POST /assignments/{assignmentId}/arrived-at-destination",
  "GET /assignments/{assignmentId}/driver-location",
  "POST /payments/webhook",
  "POST /payments/refunds/request",
  "GET /payments/refunds/admin",
  "POST /payments/refunds/admin/{refundId}/process",
  "POST /payments/payouts/request",
  "GET /payments/payouts/admin",
  "GET /payments/admin/reconciliation/payments/{reference}",
  "GET /payments/admin/reconciliation/payouts/{reference}",
  "POST /support/tickets",
  "GET /support/tickets/mine",
  "GET /support/tickets/admin",
  "PATCH /support/tickets/admin/{ticketId}",
  "POST /support/ride-bookings/{bookingId}/cancel",
  "POST /support/parcel-bookings/{bookingId}/cancel",
  "GET /admin/transport-partners",
  "POST /admin/transport-partners",
  "PATCH /admin/transport-partners/{partnerId}/status",
  "POST /admin/transport-partners/{partnerId}/agreements",
  "POST /admin/partner-agreements/{agreementId}/activate",
  "PATCH /admin/partner-agreements/{agreementId}/status",
  "POST /admin/partner-agreements/{agreementId}/rate-cards",
  "POST /admin/partner-rate-cards/{rateCardId}/rates",
  "POST /admin/partner-rate-cards/{rateCardId}/publish",
  "POST /admin/parcel-bookings/{bookingId}/quotes",
  "GET /parcel-bookings/{bookingId}/quotes",
  "POST /parcel-bookings/{bookingId}/quotes/{quoteId}/accept",
  "POST /parcel-bookings/{bookingId}/quotes/{quoteId}/reject",
  "POST /delivery-legs/{legId}/request-matching",
  "GET /driver/delivery-leg-offers",
  "POST /driver/delivery-leg-offers/{offerId}/propose-fare",
  "GET /parcel-bookings/{bookingId}/delivery-legs/{legId}/offers",
  "POST /parcel-bookings/{bookingId}/delivery-legs/{legId}/accept-fare",
  "POST /admin/transport-partners/{partnerId}/members",
  "PATCH /admin/transport-partners/{partnerId}/members/{memberId}",
  "POST /admin/delivery-legs/{legId}/partner-assignment",
  "GET /partner/assignments",
  "POST /partner/assignments/{assignmentId}/accept",
  "POST /partner/assignments/{assignmentId}/start",
  "POST /admin/hub-points/{hubPointId}/operators",
  "PATCH /admin/hub-points/{hubPointId}/operators/{operatorId}",
  "GET /custody/handovers/mine",
  "POST /custody/handovers",
  "POST /custody/handovers/{handoverId}/decision",
]);
const idempotentMutationPaths = new Set([
  "POST /parcel-bookings",
  "POST /ride-bookings",
  "POST /driver/ride-offers/{offerId}/propose-fare",
  "POST /ride-bookings/{rideBookingId}/accept-fare",
  "POST /driver/offers/{offerId}/propose-fare",
  "POST /parcel-bookings/{bookingId}/accept-fare",
  "POST /payments",
  "POST /payments/initialize",
  "POST /payments/refunds/request",
  "POST /payments/payouts/request",
  "POST /admin/delivery-legs/{legId}/partner-assignment",
]);

try {
  const api = await SwaggerParser.validate(specPath);
  const operationIds = new Set();
  const discoveredImplemented = new Set();

  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete", "options", "head"].includes(method.toLowerCase())) continue;
      const operationId = operation.operationId;
      if (!operationId) throw new Error(`Missing operationId for ${method.toUpperCase()} ${path}`);
      if (operationIds.has(operationId)) throw new Error(`Duplicate operationId: ${operationId}`);
      operationIds.add(operationId);

      const status = operation["x-implementation-status"];
      if (!allowedStatuses.has(status)) {
        throw new Error(`Invalid or missing x-implementation-status on ${method.toUpperCase()} ${path}`);
      }
      if (status === "implemented") discoveredImplemented.add(`${method.toUpperCase()} ${path}`);

      const key = `${method.toUpperCase()} ${path}`;
      if (idempotentMutationPaths.has(key)) {
        const hasIdempotencyKey = (operation.parameters ?? []).some((parameter) =>
          parameter.name === "Idempotency-Key" && parameter.in === "header" && parameter.required === true
        );
        if (!hasIdempotencyKey) throw new Error(`Missing required Idempotency-Key on ${key}`);
      }
    }
  }

  if (discoveredImplemented.size !== implementedOperations.size ||
      [...implementedOperations].some((key) => !discoveredImplemented.has(key))) {
    throw new Error(
      `Implemented-operation status drift. Expected ${[...implementedOperations].join(", ")}; got ${[...discoveredImplemented].join(", ")}.`
    );
  }

  console.log(`OpenAPI contract valid: ${api.info.title} v${api.info.version}; ${operationIds.size} operations; implementation-status and idempotency checks passed.`);
} catch (error) {
  console.error("OpenAPI validation failed:", error.message);
  process.exitCode = 1;
}
