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
  "POST /parcel-bookings",
  "GET /parcel-bookings/{bookingId}",
  "GET /parcel-bookings/{bookingId}/offers",
  "GET /driver/offers",
  "POST /driver/offers/{offerId}/propose-fare",
  "POST /parcel-bookings/{bookingId}/accept-fare",
  "POST /parcel-bookings/{bookingId}/request-matching",
  "GET /notifications",
  "PATCH /notifications/{notificationId}/read",
  "POST /notifications/read-all",
  "GET /hub-points",
  "POST /ride-bookings",
  "GET /ride-bookings/{rideBookingId}",
  "GET /drivers/me",
  "POST /drivers/onboarding",
  "PATCH /drivers/availability",
  "POST /drivers/location",
  "PATCH /drivers/admin/{driverProfileId}/verification",
  "PATCH /drivers/admin/vehicles/{vehicleId}/verification",
  "PUT /drivers/admin/coverage",
]);
const idempotentMutationPaths = new Set([
  "POST /parcel-bookings",
  "POST /driver/offers/{offerId}/propose-fare",
  "POST /parcel-bookings/{bookingId}/accept-fare",
  "POST /payments",
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
