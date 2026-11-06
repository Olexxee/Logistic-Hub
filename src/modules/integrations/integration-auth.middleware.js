import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/prisma.js";

function matchesSecret(secret, storedHash) {
  if (typeof secret !== "string" || typeof storedHash !== "string") return false;
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const actual = createHash("sha256").update(secret, "utf8").digest();
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createIntegrationAuthMiddleware({ prismaClient = prisma, clock = () => new Date() } = {}) {
  async function requireIntegrationAuth(req, res, next) {
    const keyId = req.get("x-integration-key-id");
    const secret = req.get("x-integration-secret");
    if (!keyId || !secret || keyId.length > 128 || secret.length > 256) {
      return res.status(401).json({
        success: false,
        error: { code: "INTEGRATION_UNAUTHORIZED", message: "Valid integration credentials are required." },
      });
    }

    try {
      const credential = await prismaClient.integrationCredential.findUnique({
        where: { keyId },
        select: {
          id: true, clientId: true, secretHash: true, status: true, expiresAt: true, lastUsedAt: true,
          client: { select: { id: true, code: true, name: true, status: true, scopes: true } },
        },
      });
      const now = clock();
      if (
        !credential ||
        credential.status !== "ACTIVE" ||
        credential.client.status !== "ACTIVE" ||
        (credential.expiresAt && credential.expiresAt <= now) ||
        !matchesSecret(secret, credential.secretHash)
      ) {
        return res.status(401).json({
          success: false,
          error: { code: "INTEGRATION_UNAUTHORIZED", message: "The integration credential is invalid or inactive." },
        });
      }

      req.integrationClient = {
        id: credential.client.id,
        code: credential.client.code,
        name: credential.client.name,
        scopes: credential.client.scopes,
        credentialId: credential.id,
      };

      // Usage telemetry is deliberately non-blocking: a telemetry write must
      // never turn an otherwise valid authenticated request into an outage.
      if (!credential.lastUsedAt || now.getTime() - credential.lastUsedAt.getTime() >= 5 * 60 * 1000) {
        void prismaClient.integrationCredential.update({
          where: { id: credential.id },
          data: { lastUsedAt: now },
        }).catch(() => {});
      }
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireIntegrationScope(...requiredScopes) {
    return (req, res, next) => {
      const granted = req.integrationClient?.scopes ?? [];
      if (!req.integrationClient || !requiredScopes.every(scope => granted.includes(scope))) {
        return res.status(403).json({
          success: false,
          error: { code: "INTEGRATION_SCOPE_FORBIDDEN", message: "The integration client lacks the required scope." },
        });
      }
      return next();
    };
  }

  return { requireIntegrationAuth, requireIntegrationScope };
}

export const { requireIntegrationAuth, requireIntegrationScope } = createIntegrationAuthMiddleware();

export function createIntegrationCredentialMaterial() {
  const keyId = `lhk_${randomBytes(12).toString("hex")}`;
  const secret = `lhs_${randomBytes(32).toString("hex")}`;
  const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");
  return { keyId, secret, secretHash };
}
