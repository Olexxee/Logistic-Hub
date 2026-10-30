import SwaggerParser from "@apidevtools/swagger-parser";
import { fileURLToPath } from "node:url";

const specPath = fileURLToPath(new URL("../docs/openapi.yaml", import.meta.url));
const allowedStatuses = new Set(["implemented", "planned", "planned-disabled"]);
const idempotentMutationPaths = new Set([
  "POST /parcel-bookings",
  "POST /ride-bookings",
  "POST /driver/ride-offers/{offerId}/propose-fare",
  "POST /ride-bookings/{rideBookingId}/accept-fare",
  "POST /driver/offers/{offerId}/propose-fare",
  "POST /parcel-bookings/{bookingId}/accept-fare",
  "POST /finance/refund-requests",
  "POST /admin/delivery-legs/{legId}/partner-assignment",
  "POST /admin/partner-payables/{payableId}/adjustments",
  "POST /admin/transport-partners/{partnerId}/settlement-batches",
]);

try {
  const api = await SwaggerParser.validate(specPath);
  const operationIds = new Set();

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

      const key = `${method.toUpperCase()} ${path}`;
      if (idempotentMutationPaths.has(key)) {
        const hasIdempotencyKey = (operation.parameters ?? []).some((parameter) =>
          parameter.name === "Idempotency-Key" && parameter.in === "header" && parameter.required === true
        );
        if (!hasIdempotencyKey) throw new Error(`Missing required Idempotency-Key on ${key}`);
      }
    }
  }

  console.log(`OpenAPI contract valid: ${api.info.title} v${api.info.version}; ${operationIds.size} operations; implementation-status metadata and idempotency checks passed.`);
} catch (error) {
  console.error("OpenAPI validation failed:", error.message);
  process.exitCode = 1;
}
