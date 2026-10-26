import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional().default(""),
  PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

if (parsed.data.PAYMENTS_ENABLED) {
  throw new Error(
    "PAYMENTS_ENABLED=true is blocked until the project owner explicitly approves payment implementation and deployment.",
  );
}

export const env = Object.freeze({ ...parsed.data, PAYMENTS_ENABLED: false });
