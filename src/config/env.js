import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_STAGE: z.enum(["local", "staging", "production"]).optional(),
  DRIVER_KYC_MODE: z.enum(["TEST", "STRICT"]).optional(),
  DRIVER_LOCATION_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional().default(""),
  MAPS_PROVIDER: z.enum(["none", "google"]).default("none"),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
  EMAIL_PROVIDER: z.enum(["none", "resend"]).default("none"),
  RESEND_API_KEY: z.string().optional().default(""),
  RESEND_FROM_EMAIL: z.string().optional().default(""),
  OUTBOX_ENCRYPTION_KEY: z.string().optional().default(""),
  APP_BASE_URL: z.string().url().optional().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().optional().default(""),
  PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  REFUNDS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PAYSTACK_SECRET_KEY: z.string().optional().default(""),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(""),
  CLOUDINARY_API_KEY: z.string().optional().default(""),
  CLOUDINARY_API_SECRET: z.string().optional().default(""),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional().default(""),
  FIREBASE_STORAGE_BUCKET: z.string().optional().default(""),
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

if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_PROVIDER !== "resend") {
  throw new Error("EMAIL_PROVIDER=resend is required in production for transactional email delivery.");
}

if (parsed.data.NODE_ENV === "production") {
  const outboxKey = Buffer.from(parsed.data.OUTBOX_ENCRYPTION_KEY, "base64");
  if (
    outboxKey.length !== 32
    || outboxKey.toString("base64").replace(/=+$/, "") !== parsed.data.OUTBOX_ENCRYPTION_KEY.trim().replace(/=+$/, "")
  ) {
    throw new Error("OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key in production.");
  }
}

if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_ACCESS_SECRET.length < 32) {
  throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters in production.");
}

const cloudinaryFields = [parsed.data.CLOUDINARY_CLOUD_NAME, parsed.data.CLOUDINARY_API_KEY, parsed.data.CLOUDINARY_API_SECRET].map(value => Boolean(value.trim()));
if (cloudinaryFields.some(Boolean) && !cloudinaryFields.every(Boolean)) {
  throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be configured together.");
}

if (Boolean(parsed.data.FIREBASE_SERVICE_ACCOUNT_BASE64.trim()) !== Boolean(parsed.data.FIREBASE_STORAGE_BUCKET.trim())) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 and FIREBASE_STORAGE_BUCKET must be configured together.");
}

if (parsed.data.FIREBASE_SERVICE_ACCOUNT_BASE64.trim()) {
  try {
    const credentials = JSON.parse(Buffer.from(parsed.data.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"));
    if (!credentials.project_id || !credentials.client_email || !credentials.private_key) throw new Error("Missing required service-account fields.");
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 must contain a valid base64-encoded Firebase service-account JSON document.");
  }
}

if (parsed.data.REFUNDS_ENABLED && !parsed.data.PAYSTACK_SECRET_KEY.trim()) {
  throw new Error("PAYSTACK_SECRET_KEY is required when REFUNDS_ENABLED=true.");
}

if (parsed.data.PAYMENTS_ENABLED) {
  throw new Error(
    "PAYMENTS_ENABLED=true is blocked until the project owner explicitly approves live payment activation and deployment.",
  );
}

const appStage = parsed.data.APP_STAGE ?? (parsed.data.NODE_ENV === "production" ? "production" : "local");
const driverKycMode = parsed.data.DRIVER_KYC_MODE ?? (appStage === "production" ? "STRICT" : "TEST");
if (appStage === "production" && driverKycMode !== "STRICT") {
  throw new Error("DRIVER_KYC_MODE=TEST is not permitted when APP_STAGE=production.");
}

export const env = Object.freeze({ ...parsed.data, APP_STAGE: appStage, DRIVER_KYC_MODE: driverKycMode, PAYMENTS_ENABLED: false });
