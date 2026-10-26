import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional().default(""),
  MAPS_PROVIDER: z.enum(["none", "google"]).default("none"),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
  EMAIL_PROVIDER: z.enum(["none", "resend"]).default("none"),
  RESEND_API_KEY: z.string().optional().default(""),
  RESEND_FROM_EMAIL: z.string().optional().default(""),
  APP_BASE_URL: z.string().url().optional().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().optional().default(""),
  PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PAYSTACK_SECRET_KEY: z.string().optional().default(""),
  PAYSTACK_CALLBACK_URL: z.string().url().optional().default("http://localhost:3000/payment/return"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

if (parsed.data.MAPS_PROVIDER === "google" && !parsed.data.GOOGLE_MAPS_API_KEY.trim()) {
  throw new Error("GOOGLE_MAPS_API_KEY is required when MAPS_PROVIDER=google.");
}

if (parsed.data.EMAIL_PROVIDER === "resend") {
  if (!parsed.data.RESEND_API_KEY.trim()) {
    throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend.");
  }
  if (!z.string().email().safeParse(parsed.data.RESEND_FROM_EMAIL).success) {
    throw new Error("RESEND_FROM_EMAIL must be a valid sender email when EMAIL_PROVIDER=resend.");
  }
}

if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_ACCESS_SECRET.length < 32) {
  throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters in production.");
}

if (parsed.data.PAYMENTS_ENABLED && !parsed.data.PAYSTACK_SECRET_KEY.trim()) {
  throw new Error("PAYSTACK_SECRET_KEY is required when PAYMENTS_ENABLED=true.");
}

export const env = Object.freeze({ ...parsed.data, PAYMENTS_ENABLED: false });
