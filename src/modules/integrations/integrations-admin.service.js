import { createIntegrationsAdminRepository } from "./integrations-admin.repository.js";
import { createIntegrationCredentialMaterial } from "./integration-auth.middleware.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/http/app-error.js";

function safeClient(client) {
  return {
    id: client.id, code: client.code, name: client.name, status: client.status,
    scopes: client.scopes, createdAt: client.createdAt, updatedAt: client.updatedAt,
  };
}

export function createIntegrationsAdminService({ prismaClient, clock = () => new Date() }) {
  const repository = createIntegrationsAdminRepository({ prismaClient });

  async function audit(tx, actorUserId, entityType, entityId, action, reason, before, after) {
    await repository.writeAudit(tx, {
      actorUserId, entityType, entityId, action, reason,
      before: before ?? undefined, after: after ?? undefined,
    });
  }

  return {
    async listClients({ status, search, page = 1, limit = 25 }) {
      const filters = { status, search };
      const [items, total] = await Promise.all([
        repository.listClients({ ...filters, skip: (page - 1) * limit, take: limit }),
        repository.countClients(filters),
      ]);
      return {
        items: items.map(({ _count, ...client }) => ({ ...safeClient(client), credentialCount: _count.credentials, billingAgreementCount: _count.billingAgreements })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },

    async createClient({ code, name, scopes, metadata, reason, actorUserId }) {
      return repository.transaction(async tx => {
        const client = await repository.createClient({ code, name, scopes, metadata }, tx);
        await audit(tx, actorUserId, "INTEGRATION_CLIENT", client.id, "INTEGRATION_CLIENT_CREATED", reason, null, {
          code, name, scopes, status: client.status,
        });
        return safeClient(client);
      });
    },

    async updateClientStatus({ clientId, status, reason, actorUserId }) {
      return repository.transaction(async tx => {
        const client = await repository.findClient(clientId, tx);
        if (!client) throw new NotFoundError("Integration client not found.", "INTEGRATION_CLIENT_NOT_FOUND");
        if (client.status === "REVOKED" && status !== "REVOKED") {
          throw new ConflictError("A revoked integration client cannot be reactivated; register a new client.", "INTEGRATION_CLIENT_REVOKED");
        }
        if (client.status === status) return { client: safeClient(client), replay: true };
        const updated = await repository.updateClient(clientId, { status }, tx);
        await audit(tx, actorUserId, "INTEGRATION_CLIENT", clientId, "INTEGRATION_CLIENT_STATUS_CHANGED", reason,
          { status: client.status }, { status: updated.status });
        return { client: safeClient(updated), replay: false };
      });
    },

    async issueCredential({ clientId, label, expiresAt, reason, actorUserId }) {
      if (expiresAt && expiresAt <= clock()) throw new ValidationError("Credential expiry must be in the future.");
      return repository.transaction(async tx => {
        const client = await repository.findClient(clientId, tx);
        if (!client) throw new NotFoundError("Integration client not found.", "INTEGRATION_CLIENT_NOT_FOUND");
        if (client.status !== "ACTIVE") throw new ConflictError("Credentials can only be issued to active integration clients.", "INTEGRATION_CLIENT_INACTIVE");
        const material = createIntegrationCredentialMaterial();
        const credential = await repository.createCredential({
          clientId, keyId: material.keyId, secretHash: material.secretHash, label, expiresAt,
        }, tx);
        await audit(tx, actorUserId, "INTEGRATION_CREDENTIAL", credential.id, "INTEGRATION_CREDENTIAL_ISSUED", reason, null, {
          clientId, keyId: credential.keyId, label, expiresAt: credential.expiresAt,
        });
        return {
          credential: {
            id: credential.id, keyId: credential.keyId, label: credential.label,
            status: credential.status, expiresAt: credential.expiresAt, createdAt: credential.createdAt,
          },
          secret: material.secret,
          warning: "This secret is shown once. Store it securely; it cannot be retrieved later.",
        };
      });
    },

    async revokeCredential({ credentialId, reason, actorUserId }) {
      return repository.transaction(async tx => {
        const credential = await repository.findCredential(credentialId, tx);
        if (!credential) throw new NotFoundError("Integration credential not found.", "INTEGRATION_CREDENTIAL_NOT_FOUND");
        if (credential.status === "REVOKED") {
          return { id: credential.id, status: credential.status, replay: true };
        }
        const now = clock();
        const revoked = await repository.revokeCredential(credentialId, now, tx);
        await audit(tx, actorUserId, "INTEGRATION_CREDENTIAL", credentialId, "INTEGRATION_CREDENTIAL_REVOKED", reason,
          { status: credential.status }, { status: revoked.status, clientId: credential.clientId, keyId: credential.keyId });
        return { id: revoked.id, status: revoked.status, revokedAt: revoked.revokedAt, replay: false };
      });
    },

    async createBillingAgreement({ clientId, reference, billingModel, effectiveFrom, effectiveUntil, terms, reason, actorUserId }) {
      const from = effectiveFrom ?? clock();
      if (effectiveUntil && effectiveUntil <= from) throw new ValidationError("Agreement end date must be later than its start date.");
      return repository.transaction(async tx => {
        const client = await repository.findClient(clientId, tx);
        if (!client) throw new NotFoundError("Integration client not found.", "INTEGRATION_CLIENT_NOT_FOUND");
        if (client.status !== "ACTIVE") throw new ConflictError("Billing agreements can only be created for active integration clients.", "INTEGRATION_CLIENT_INACTIVE");
        const current = await repository.maxAgreementVersion(clientId, reference, tx);
        const agreement = await repository.createAgreement({
          clientId, reference, version: (current._max.version ?? 0) + 1,
          billingModel, effectiveFrom: from, effectiveUntil, terms, status: "DRAFT",
        }, tx);
        await audit(tx, actorUserId, "INTEGRATION_BILLING_AGREEMENT", agreement.id, "INTEGRATION_BILLING_AGREEMENT_CREATED", reason, null, {
          reference, version: agreement.version, billingModel, currency: agreement.currency, status: agreement.status,
          effectiveFrom: agreement.effectiveFrom, effectiveUntil: agreement.effectiveUntil,
        });
        return agreement;
      });
    },
  };
}
