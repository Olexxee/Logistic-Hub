import { ConflictError, NotFoundError, ValidationError } from "../../shared/http/app-error.js";
import { encryptWebhookSecret, createWebhookSigningSecret, validateWebhookEndpointUrl } from "./integration-webhook.security.js";

const endpointSelect = {
  id: true, url: true, description: true, eventTypes: true, status: true,
  currentSecretVersion: true, revokedAt: true, createdAt: true, updatedAt: true,
};

function safeEndpoint(endpoint) {
  const { currentSecretVersion, ...safe } = endpoint;
  return { ...safe, secretVersion: currentSecretVersion };
}

export function createIntegrationWebhookService({
  prismaClient,
  clock = () => new Date(),
  lookup,
  encryptionKey,
} = {}) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function writeAudit(tx, { clientId, endpointId, credentialId, action, metadata }) {
    await tx.integrationWebhookAuditEvent.create({
      data: { clientId, endpointId, actorCredentialId: credentialId, action, metadata },
    });
  }

  async function findEndpoint(tx, clientId, endpointId) {
    const endpoint = await tx.integrationWebhookEndpoint.findFirst({
      where: { id: endpointId, clientId },
      select: endpointSelect,
    });
    if (!endpoint) throw new NotFoundError("Webhook endpoint not found.", "INTEGRATION_WEBHOOK_ENDPOINT_NOT_FOUND");
    return endpoint;
  }

  return {
    async listEndpoints({ clientId, page = 1, limit = 25 }) {
      const rows = await prismaClient.integrationWebhookEndpoint.findMany({
        where: { clientId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit + 1,
        select: endpointSelect,
      });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: items.map(safeEndpoint),
        pagination: { page, limit, hasMore, nextPage: hasMore ? page + 1 : null },
      };
    },

    async createEndpoint({ clientId, credentialId, url, description, eventTypes }) {
      const normalizedUrl = await validateWebhookEndpointUrl(url, { lookup });
      const secret = createWebhookSigningSecret();
      const endpoint = await prismaClient.$transaction(async tx => {
        const client = await tx.integrationClient.findUnique({
          where: { id: clientId },
          select: { id: true, status: true },
        });
        if (!client || client.status !== "ACTIVE") {
          throw new ConflictError("Webhook endpoints can only be registered for an active integration client.", "INTEGRATION_CLIENT_INACTIVE");
        }

        const created = await tx.integrationWebhookEndpoint.create({
          data: {
            clientId,
            url: normalizedUrl,
            description,
            eventTypes,
            currentSecretVersion: 1,
          },
          select: endpointSelect,
        });
        const encrypted = encryptWebhookSecret(secret, {
          endpointId: created.id,
          version: 1,
          encryptionKey,
        });
        await tx.integrationWebhookSecretVersion.create({
          data: { endpointId: created.id, version: 1, ...encrypted },
        });
        await writeAudit(tx, {
          clientId, endpointId: created.id, credentialId,
          action: "WEBHOOK_ENDPOINT_CREATED",
          metadata: { url: normalizedUrl, eventTypes, secretVersion: 1 },
        });
        return created;
      });
      return {
        endpoint: safeEndpoint(endpoint),
        secret,
        warning: "This signing secret is shown once. Store it securely; it cannot be retrieved later.",
      };
    },

    async updateEndpoint({ clientId, credentialId, endpointId, status, description, eventTypes, reason }) {
      return prismaClient.$transaction(async tx => {
        const endpoint = await findEndpoint(tx, clientId, endpointId);
        if (
          endpoint.status === "REVOKED"
          && (description !== undefined || eventTypes || (status && status !== "REVOKED"))
        ) {
          throw new ConflictError("A revoked webhook endpoint cannot be changed or reactivated.", "INTEGRATION_WEBHOOK_ENDPOINT_REVOKED");
        }
        if (status && status !== endpoint.status && !reason) {
          throw new ValidationError("A reason is required when changing webhook endpoint status.");
        }
        if (status === "ACTIVE" && endpoint.status !== "ACTIVE") {
          const client = await tx.integrationClient.findUnique({
            where: { id: clientId }, select: { status: true },
          });
          if (client?.status !== "ACTIVE") {
            throw new ConflictError("Webhook endpoints can only be activated for an active integration client.", "INTEGRATION_CLIENT_INACTIVE");
          }
        }
        const data = {
          ...(status ? { status, ...(status === "REVOKED" ? { revokedAt: clock() } : {}) } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(eventTypes ? { eventTypes } : {}),
        };
        if (Object.keys(data).length === 0) throw new ValidationError("No endpoint changes were supplied.");
        const updated = await tx.integrationWebhookEndpoint.update({
          where: { id: endpointId }, data, select: endpointSelect,
        });
        const changed = {
          ...(status && status !== endpoint.status ? { status: { from: endpoint.status, to: updated.status } } : {}),
          ...(description !== undefined ? { descriptionChanged: true } : {}),
          ...(eventTypes ? { eventTypes } : {}),
          ...(reason ? { reason } : {}),
        };
        await writeAudit(tx, {
          clientId, endpointId, credentialId,
          action: status === "REVOKED" ? "WEBHOOK_ENDPOINT_REVOKED" : status === "SUSPENDED" ? "WEBHOOK_ENDPOINT_SUSPENDED" : status === "ACTIVE" ? "WEBHOOK_ENDPOINT_ACTIVATED" : "WEBHOOK_ENDPOINT_UPDATED",
          metadata: changed,
        });
        return { endpoint: safeEndpoint(updated), replay: status === endpoint.status && Object.keys(data).length === 1 };
      });
    },

    async rotateSecret({ clientId, credentialId, endpointId, reason }) {
      if (!reason) throw new ValidationError("A reason is required when rotating a webhook signing secret.");
      const secret = createWebhookSigningSecret();
      return prismaClient.$transaction(async tx => {
        const endpoint = await findEndpoint(tx, clientId, endpointId);
        if (endpoint.status === "REVOKED") {
          throw new ConflictError("A revoked webhook endpoint cannot rotate its signing secret.", "INTEGRATION_WEBHOOK_ENDPOINT_REVOKED");
        }
        const updated = await tx.integrationWebhookEndpoint.update({
          where: { id: endpointId },
          data: { currentSecretVersion: { increment: 1 } },
          select: endpointSelect,
        });
        const version = updated.currentSecretVersion;
        const encrypted = encryptWebhookSecret(secret, {
          endpointId,
          version,
          encryptionKey,
        });
        await tx.integrationWebhookSecretVersion.create({
          data: { endpointId, version, ...encrypted },
        });
        await writeAudit(tx, {
          clientId, endpointId, credentialId,
          action: "WEBHOOK_SECRET_ROTATED",
          metadata: { fromVersion: endpoint.currentSecretVersion, toVersion: version, reason },
        });
        return {
          endpoint: safeEndpoint(updated),
          secret,
          warning: "This signing secret is shown once. Store it securely; it cannot be retrieved later.",
        };
      });
    },
  };
}
