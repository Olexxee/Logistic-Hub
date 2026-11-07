import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../../config/env.js";
import { ServiceUnavailableError, ValidationError } from "../../shared/http/app-error.js";

function parseEncryptionKey(value = env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
  const key = Buffer.from(value ?? "", "base64");
  if (
    key.length !== 32
    || key.toString("base64").replace(/=+$/, "") !== String(value ?? "").trim().replace(/=+$/, "")
  ) {
    throw new ServiceUnavailableError(
      "Webhook secret encryption is not configured. Contact the integration administrator.",
      "WEBHOOK_SECRET_ENCRYPTION_NOT_CONFIGURED",
    );
  }
  return key;
}

function isPublicIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) !== 6) return false;
  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (firstHextet < 0x2000 || firstHextet > 0x3fff) return false;
  if (normalized.startsWith("2001:0:") || normalized.startsWith("2001:db8:")) return false;
  if (normalized.startsWith("2002:") || normalized.startsWith("3fff:")) return false;
  return true;
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export async function validateWebhookEndpointUrl(input, { lookup = dnsLookup } = {}) {
  if (typeof input !== "string" || input.length > 2048) {
    throw new ValidationError("Webhook URL must be a valid HTTPS URL no longer than 2048 characters.");
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new ValidationError("Webhook URL must be a valid HTTPS URL.");
  }

  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.search
    || (parsed.port && parsed.port !== "443")
  ) {
    throw new ValidationError("Webhook URLs must use HTTPS on port 443 and cannot contain credentials, query strings or fragments.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".test")
    || hostname.endsWith(".invalid")
    || hostname.endsWith(".example")
    || hostname.endsWith(".onion")
    || isIP(hostname)
  ) {
    throw new ValidationError("Webhook URL host must be a public DNS hostname.");
  }

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ValidationError("Webhook URL host must resolve to public IP addresses.");
  }
  if (!Array.isArray(records) || records.length === 0 || records.some(record => !isPublicAddress(record.address))) {
    throw new ValidationError("Webhook URL host must resolve exclusively to public IP addresses.");
  }

  parsed.hostname = hostname;
  return parsed.toString();
}

export function createWebhookSigningSecret() {
  return `lhwhsec_${randomBytes(32).toString("base64url")}`;
}

export function encryptWebhookSecret(secret, { endpointId, version, encryptionKey = env.WEBHOOK_SECRET_ENCRYPTION_KEY } = {}) {
  const key = parseEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${endpointId}:${version}`, "utf8"));
  const encryptedValue = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    encryptedValue: encryptedValue.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptWebhookSecret(record, { encryptionKey = env.WEBHOOK_SECRET_ENCRYPTION_KEY } = {}) {
  const key = parseEncryptionKey(encryptionKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAAD(Buffer.from(`${record.endpointId}:${record.version}`, "utf8"));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
