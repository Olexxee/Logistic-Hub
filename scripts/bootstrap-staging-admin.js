import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createOpaqueToken, hashOpaqueToken, hashPassword } from "../src/modules/auth/auth.crypto.js";

const EXPECTED_DATABASE_HOST = "db.prisma.io";
const EXPECTED_DATABASE_NAME = "postgres";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function parseBootstrapArguments(args = []) {
  const allowed = new Set(["--apply"]);
  for (const arg of args) {
    if (allowed.has(arg) || arg.startsWith("--confirm-staging-database=")) continue;
    throw new Error("Unknown argument: " + arg);
  }

  const confirmations = args.filter((arg) => arg.startsWith("--confirm-staging-database="));
  if (confirmations.length > 1) throw new Error("Provide --confirm-staging-database only once.");
  const confirmation = confirmations[0]?.slice("--confirm-staging-database=".length) ?? null;

  if (confirmation && !args.includes("--apply")) {
    throw new Error("--confirm-staging-database is only valid with --apply.");
  }

  return {
    apply: args.includes("--apply"),
    confirmedDatabase: confirmation,
  };
}

export function validateStagingAdminBootstrapConfig(environment = process.env, args = []) {
  const options = parseBootstrapArguments(args);

  if (environment.APP_STAGE !== "staging") {
    throw new Error("Admin bootstrap is restricted to APP_STAGE=staging.");
  }
  if (environment.NODE_ENV !== "development") {
    throw new Error("Admin bootstrap requires NODE_ENV=development; production mode is never permitted.");
  }
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  let databaseUrl;
  try {
    databaseUrl = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (databaseUrl.hostname !== EXPECTED_DATABASE_HOST) {
    throw new Error("Admin bootstrap is restricted to the dedicated staging database host.");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
  if (databaseName !== EXPECTED_DATABASE_NAME) {
    throw new Error("Admin bootstrap is restricted to the expected staging database name.");
  }
  if (!databaseUrl.username || !databaseUrl.password) {
    throw new Error("DATABASE_URL must include database authentication.");
  }

  const email = String(environment.STAGING_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const fullName = String(environment.STAGING_ADMIN_FULL_NAME ?? "").trim();
  const password = String(environment.STAGING_ADMIN_PASSWORD ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("STAGING_ADMIN_EMAIL must be a valid email address.");
  }
  if (fullName.length < 2 || fullName.length > 160) {
    throw new Error("STAGING_ADMIN_FULL_NAME must contain 2–160 characters.");
  }
  if (password.length < 16 || password.length > 128) {
    throw new Error("STAGING_ADMIN_PASSWORD must contain 16–128 characters.");
  }
  if (options.apply && options.confirmedDatabase !== databaseName) {
    throw new Error("Apply requires --confirm-staging-database=" + databaseName + " to confirm the exact staging target.");
  }

  return {
    ...options,
    database: { host: databaseUrl.hostname, name: databaseName },
    admin: { email, fullName, password },
  };
}

export async function runStagingAdminBootstrap(args = process.argv.slice(2), dependencies = {}) {
  const config = validateStagingAdminBootstrapConfig(dependencies.environment ?? process.env, args);
  const prismaClient = dependencies.prismaClient ?? new PrismaClient();

  try {
    const existingUserCount = await prismaClient.user.count();
    const existingAdminCount = await prismaClient.user.count({ where: { role: "ADMIN" } });

    if (existingUserCount > 0 || existingAdminCount > 0) {
      throw new Error(
        "Staging Admin bootstrap requires an empty users table. "
        + "Existing users: " + existingUserCount + "; existing Admins: " + existingAdminCount + ". "
        + "This bootstrap is intentionally one-time and will not promote or overwrite accounts.",
      );
    }

    if (!config.apply) {
      console.log(JSON.stringify({
        mode: "DRY_RUN",
        database: config.database,
        existingUsers: existingUserCount,
        admin: { email: config.admin.email, role: "ADMIN", status: "PENDING" },
        writesPerformed: false,
        nextStep: "Pass --apply --confirm-staging-database=postgres to create the first staging Admin.",
      }, null, 2));
      return;
    }

    const passwordHash = await hashPassword(config.admin.password);
    const rawToken = createOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

    const createdUser = await prismaClient.$transaction(async (tx) => {
      const usersInTransaction = await tx.user.count();
      if (usersInTransaction !== 0) {
        throw new Error("Staging Admin bootstrap aborted because a user was created after the preflight check.");
      }

      const user = await tx.user.create({
        data: {
          fullName: config.admin.fullName,
          email: config.admin.email,
          passwordHash,
          role: "ADMIN",
          status: "PENDING",
        },
        select: { id: true, fullName: true, email: true, role: true, status: true },
      });

      await tx.authActionToken.create({
        data: {
          userId: user.id,
          purpose: "EMAIL_VERIFICATION",
          tokenHash: hashOpaqueToken(rawToken),
          expiresAt,
        },
      });

      await tx.operationalAuditEvent.create({
        data: {
          entityType: "USER",
          entityId: user.id,
          action: "STAGING_ADMIN_BOOTSTRAPPED",
          reason: "Initial staging administrator provisioned through the guarded one-time bootstrap.",
          after: { email: user.email, role: user.role, status: user.status },
          metadata: {
            source: "staging-admin-bootstrap",
            appStage: "staging",
            databaseName: config.database.name,
            emailVerificationRequired: true,
          },
        },
      });

      return user;
    }, {
      isolationLevel: "Serializable",
      maxWait: 10000,
      timeout: 30000,
    });

    console.log("\nStaging Admin bootstrap completed.");
    console.log(JSON.stringify({
      database: config.database,
      account: createdUser,
      verification: {
        required: true,
        endpoint: "POST /api/v1/auth/verify-email",
        token: rawToken,
        expiresAt: expiresAt.toISOString(),
        note: "Use this one-time token locally to verify the Admin email. Do not commit it or share it in chat.",
      },
    }, null, 2));
  } finally {
    if (!dependencies.prismaClient) await prismaClient.$disconnect();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runStagingAdminBootstrap().catch((error) => {
    console.error("Staging Admin bootstrap failed: " + error.message);
    process.exitCode = 1;
  });
}
