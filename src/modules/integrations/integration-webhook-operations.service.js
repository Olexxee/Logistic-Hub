import { ConflictError, NotFoundError, TooManyRequestsError, ValidationError } from "../../shared/http/app-error.js";

const REPLAY_WINDOW_MS = 60_000;
const MAX_REPLAYS_PER_WINDOW = 10;
const MAX_REPLAY_RANGE = 100;

export function createIntegrationWebhookOperationsService({ prismaClient, clock = () => new Date() } = {}) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function findActiveEndpoint(tx, clientId, endpointId) {
    const endpoint = await tx.integrationWebhookEndpoint.findFirst({
      where: { id: endpointId, clientId },
      select: { id: true, status: true, eventTypes: true },
    });
    if (!endpoint) throw new NotFoundError("Webhook endpoint not found.", "INTEGRATION_WEBHOOK_ENDPOINT_NOT_FOUND");
    if (endpoint.status !== "ACTIVE") {
      throw new ConflictError("Webhook replay requires an active endpoint.", "INTEGRATION_WEBHOOK_ENDPOINT_NOT_ACTIVE");
    }
    const client = await tx.integrationClient.findUnique({
      where: { id: clientId },
      select: { status: true },
    });
    if (client?.status !== "ACTIVE") {
      throw new ConflictError("Webhook replay requires an active integration client.", "INTEGRATION_CLIENT_INACTIVE");
    }
    return endpoint;
  }

  async function enforceReplayRateLimit(tx, { clientId, endpointId, now }) {
    // Serialize replay requests per endpoint before checking the audit window.
    // This makes the database-backed limit effective across API instances.
    await tx.$queryRaw`SELECT "id" FROM "integration_webhook_endpoints"
      WHERE "id" = ${endpointId} AND "clientId" = ${clientId}
      FOR UPDATE`;
    const count = await tx.integrationWebhookAuditEvent.count({
      where: {
        clientId,
        endpointId,
        action: "WEBHOOK_DELIVERY_REPLAY_REQUESTED",
        createdAt: { gte: new Date(now.getTime() - REPLAY_WINDOW_MS) },
      },
    });
    if (count >= MAX_REPLAYS_PER_WINDOW) {
      throw new TooManyRequestsError("Webhook replay limit exceeded for this endpoint.", 60);
    }
  }

  return {
    async listDeliveries({ clientId, endpointId, status, page = 1, limit = 25 }) {
      if (endpointId) {
        const endpoint = await prismaClient.integrationWebhookEndpoint.findFirst({
          where: { id: endpointId, clientId },
          select: { id: true },
        });
        if (!endpoint) throw new NotFoundError("Webhook endpoint not found.", "INTEGRATION_WEBHOOK_ENDPOINT_NOT_FOUND");
      }
      const where = {
        endpoint: { clientId },
        ...(endpointId ? { endpointId } : {}),
        ...(status ? { status } : {}),
      };
      const [rows, total] = await Promise.all([
        prismaClient.integrationWebhookDelivery.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true, eventId: true, endpointId: true, status: true,
            attempts: true, totalAttempts: true, replayCount: true,
            availableAt: true, lastHttpStatus: true, lastErrorCode: true,
            deliveredAt: true, createdAt: true, updatedAt: true,
            event: {
              select: {
                eventType: true, sequence: true, occurredAt: true, payload: true,
              },
            },
          },
        }),
        prismaClient.integrationWebhookDelivery.count({ where }),
      ]);
      return {
        items: rows.map(row => ({
          id: row.id,
          eventId: row.eventId,
          endpointId: row.endpointId,
          eventType: row.event.eventType,
          sequence: row.event.sequence,
          occurredAt: row.event.occurredAt,
          shipmentReference: row.event.payload?.shipmentReference ?? null,
          status: row.status,
          attempts: row.attempts,
          totalAttempts: row.totalAttempts,
          replayCount: row.replayCount,
          nextAttemptAt: row.status === "PENDING" ? row.availableAt : null,
          lastHttpStatus: row.lastHttpStatus,
          lastErrorCode: row.lastErrorCode,
          deliveredAt: row.deliveredAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },

    async replayDeliveries({ clientId, credentialId, endpointId, eventId, shipmentId, fromSequence, toSequence }) {
      if (!eventId && (!shipmentId || fromSequence === undefined || toSequence === undefined)) {
        throw new ValidationError("Supply eventId or shipmentId with fromSequence and toSequence.");
      }
      if (eventId && (shipmentId || fromSequence !== undefined || toSequence !== undefined)) {
        throw new ValidationError("Replay accepts either eventId or a shipment sequence range, not both.");
      }
      if (fromSequence !== undefined && (toSequence < fromSequence || toSequence - fromSequence + 1 > MAX_REPLAY_RANGE)) {
        throw new ValidationError(`Replay sequence ranges must be ordered and contain no more than ${MAX_REPLAY_RANGE} sequence values.`);
      }

      const now = clock();
      return prismaClient.$transaction(async tx => {
        const endpoint = await findActiveEndpoint(tx, clientId, endpointId);
        await enforceReplayRateLimit(tx, { clientId, endpointId, now });

        const eventWhere = eventId
          ? { id: eventId, clientId, eventType: { in: endpoint.eventTypes } }
          : {
              clientId,
              parcelBookingId: shipmentId,
              sequence: { gte: fromSequence, lte: toSequence },
              eventType: { in: endpoint.eventTypes },
            };
        const rows = await tx.integrationWebhookDelivery.findMany({
          where: {
            endpointId,
            status: { in: ["SUCCEEDED", "DEAD"] },
            event: eventWhere,
          },
          orderBy: [{ event: { sequence: "asc" } }, { id: "asc" }],
          take: MAX_REPLAY_RANGE + 1,
          select: { id: true, eventId: true },
        });
        if (rows.length > MAX_REPLAY_RANGE) {
          throw new ValidationError(`Replay is limited to ${MAX_REPLAY_RANGE} existing deliveries per request.`);
        }
        if (!rows.length) {
          throw new NotFoundError("No replayable delivery was found for this endpoint and event selection.", "INTEGRATION_WEBHOOK_DELIVERY_NOT_FOUND");
        }

        const ids = rows.map(row => row.id);
        const updated = await tx.integrationWebhookDelivery.updateMany({
          where: { id: { in: ids }, endpointId, status: { in: ["SUCCEEDED", "DEAD"] } },
          data: {
            status: "PENDING",
            attempts: 0,
            replayCount: { increment: 1 },
            availableAt: now,
            lockedAt: null,
            lockedBy: null,
            lastHttpStatus: null,
            lastErrorCode: null,
            deliveredAt: null,
          },
        });
        if (updated.count !== rows.length) {
          throw new ConflictError("Delivery state changed while replay was being scheduled. Retry the request.", "INTEGRATION_WEBHOOK_REPLAY_CONFLICT");
        }

        await tx.integrationWebhookAuditEvent.create({
          data: {
            clientId,
            endpointId,
            actorCredentialId: credentialId,
            action: "WEBHOOK_DELIVERY_REPLAY_REQUESTED",
            metadata: {
              selection: eventId ? { eventId } : { shipmentId, fromSequence, toSequence },
              deliveryCount: updated.count,
              deliveryIds: ids,
            },
          },
        });
        return {
          endpointId,
          requeuedCount: updated.count,
          deliveryIds: ids,
          scheduledAt: now,
        };
      });
    },
  };
}
